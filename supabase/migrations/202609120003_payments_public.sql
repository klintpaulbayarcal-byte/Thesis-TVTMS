-- Fixed business operations exposed only to the backend service role.
create or replace function public.tvtms_payment_record(p_ticket_id bigint,p_receipt text,p_amount numeric,p_date date,p_method text,p_notes text,p_actor bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t record; paid numeric; penalty numeric; balance numeric; total numeric; ps text; ns text; payment_id bigint;
begin
 if not exists(select 1 from public.users where id=p_actor and role='admin' and status='active') then
 return jsonb_build_object('errorCode','ACCESS_DENIED','message','Administrator access required','statusCode',403); end if;
 if p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) or coalesce(length(trim(p_receipt)),0) not between 1 and 50 or p_method is null or p_method not in ('cash','gcash','maya','bank_transfer','other') or length(p_notes)>2000 then
 return jsonb_build_object('errorCode','VALIDATION_ERROR','message','Invalid payment details','statusCode',400); end if;
 if p_date is null or p_date>(current_timestamp at time zone 'Asia/Manila')::date then
 return jsonb_build_object('errorCode','INVALID_PAYMENT_DATE','message','Payment date cannot be in the future','statusCode',400); end if;
 select ti.*,coalesce(ti.penalty_amount_at_issue,v.penalty_amount) penalty,ve.owner_name,ve.owner_email into t from public.tickets ti join public.violations v on v.id=ti.violation_id join public.vehicles ve on ve.id=ti.vehicle_id where ti.id=p_ticket_id for update of ti;
 if not found then return jsonb_build_object('errorCode','TICKET_NOT_FOUND','message','Ticket not found','statusCode',404); end if;
 if t.status='cancelled' then return jsonb_build_object('errorCode','TICKET_CANCELLED','message','Cancelled tickets cannot receive payments','statusCode',409); end if;
 if exists(select 1 from public.disputes where ticket_id=p_ticket_id and status in ('submitted','under_review')) then return jsonb_build_object('errorCode','ACTIVE_DISPUTE','message','Resolve the active dispute before recording payment','statusCode',409); end if;
 if exists(select 1 from public.payments where official_receipt_number=p_receipt) then return jsonb_build_object('errorCode','OR_NUMBER_EXISTS','message','Official receipt number already exists','statusCode',409); end if;
 select coalesce(sum(amount_paid),0) into paid from public.payments where ticket_id=p_ticket_id and payment_status<>'voided';
 penalty:=t.penalty; balance:=greatest(0,penalty-paid);
 if balance<=0 or t.status='paid' then return jsonb_build_object('errorCode','ALREADY_PAID','message','This ticket is already fully paid','statusCode',409); end if;
 if p_amount>balance+0.001 then return jsonb_build_object('errorCode','OVERPAYMENT','message','Payment exceeds the remaining balance of PHP '||to_char(balance,'FM999999990.00'),'statusCode',400); end if;
 total:=paid+p_amount; ps:=case when total+0.001>=penalty then 'full' else 'partial' end; ns:=case when ps='full' then 'paid' else 'unpaid' end;
 insert into public.payments(ticket_id,official_receipt_number,amount_paid,payment_date,payment_method,payment_status,notes,recorded_by) values(p_ticket_id,p_receipt,p_amount,p_date,p_method,ps,p_notes,p_actor) returning id into payment_id;
 update public.tickets set status=ns,payment_date=case when ps='full' then p_date else null end where id=p_ticket_id;
 insert into public.ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason) values(p_ticket_id,t.status,case when ps='full' then 'paid' else 'partially_paid' end,p_actor,'Payment recorded. OR: '||p_receipt);
 return jsonb_build_object('paymentId',payment_id,'ticket',to_jsonb(t),'paymentStatus',ps,'total',total,'penalty',penalty,'nextStatus',ns);
exception when unique_violation then
 return jsonb_build_object('errorCode','OR_NUMBER_EXISTS','message','Official receipt number already exists','statusCode',409);
end; $$;

create or replace function public.tvtms_dispute_create(p_ticket_id bigint,p_reason text,p_actor bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.tickets%rowtype; actor_role text; deadline integer; dispute_id bigint;
begin
 select role into actor_role from public.users where id=p_actor and status='active';
 if actor_role is null or actor_role not in ('admin','apprehending_officer') then return jsonb_build_object('errorCode','DISPUTE_ACCESS_DENIED','message','Access denied','statusCode',403); end if;
 if coalesce(length(trim(p_reason)),0) not between 10 and 4000 then return jsonb_build_object('errorCode','VALIDATION_ERROR','message','Ticket and a reason of at least 10 characters are required','statusCode',400); end if;
 select * into t from public.tickets where id=p_ticket_id for update;
 if not found then return jsonb_build_object('errorCode','TICKET_NOT_FOUND','message','Ticket not found','statusCode',404); end if;
 if actor_role='apprehending_officer' and t.user_id<>p_actor then return jsonb_build_object('errorCode','DISPUTE_ACCESS_DENIED','message','You can only submit a dispute note for a ticket you issued','statusCode',403); end if;
 if t.status<>'unpaid' then return jsonb_build_object('errorCode','INVALID_TICKET_STATUS','message','Only unpaid tickets can be disputed','statusCode',409); end if;
 select coalesce((select setting_value::integer from public.system_settings where setting_key='dispute_deadline_days'),15) into deadline;
 if current_date-t.date_issued>deadline then return jsonb_build_object('errorCode','DISPUTE_DEADLINE_EXPIRED','message','The '||deadline||'-day dispute period has ended','statusCode',403); end if;
 if exists(select 1 from public.disputes where ticket_id=p_ticket_id and status in ('submitted','under_review')) then return jsonb_build_object('errorCode','DISPUTE_ALREADY_EXISTS','message','An active dispute already exists for this ticket','statusCode',409); end if;
 insert into public.disputes(ticket_id,submitted_by,submission_source,reason,status) values(p_ticket_id,p_actor,'internal',p_reason,'submitted') returning id into dispute_id;
 return jsonb_build_object('disputeId',dispute_id);
end; $$;

create or replace function public.tvtms_dispute_resolve(p_id bigint,p_status text,p_notes text,p_actor bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d record; ticket_id_value bigint;
begin
 if not exists(select 1 from public.users where id=p_actor and role='admin' and status='active') then return jsonb_build_object('errorCode','ACCESS_DENIED','message','Administrator access required','statusCode',403); end if;
 if p_status is null or p_status not in ('under_review','approved','rejected','closed') then return jsonb_build_object('errorCode','INVALID_STATUS','message','Invalid dispute status','statusCode',400); end if;
 if length(p_notes)>4000 or (p_status in ('approved','rejected','closed') and coalesce(length(trim(p_notes)),0)<5) then return jsonb_build_object('errorCode','VALIDATION_ERROR','message','Resolution notes of at least 5 characters are required','statusCode',400); end if;
 select ticket_id into ticket_id_value from public.disputes where id=p_id;
 -- Match the payment and filing lock order: ticket first, then its dispute.
 perform 1 from public.tickets where id=ticket_id_value for update;
 select di.*,t.ticket_number,t.status ticket_status,v.owner_email,v.owner_name into d from public.disputes di join public.tickets t on t.id=di.ticket_id join public.vehicles v on v.id=t.vehicle_id where di.id=p_id for update of di;
 if not found then return jsonb_build_object('errorCode','DISPUTE_NOT_FOUND','message','Dispute not found','statusCode',404); end if;
 if d.status in ('approved','rejected','closed') then return jsonb_build_object('errorCode','DISPUTE_FINALIZED','message','This dispute is already finalized','statusCode',409); end if;
 if p_status='approved' and (select coalesce(sum(amount_paid),0) from public.payments where ticket_id=d.ticket_id and payment_status<>'voided')>0 then return jsonb_build_object('errorCode','PAYMENT_EXISTS','message','A dispute cannot be approved after payment has been recorded','statusCode',409); end if;
 update public.disputes set status=p_status,resolution_notes=p_notes,resolved_by=p_actor,resolved_at=case when p_status in ('approved','rejected','closed') then current_timestamp else null end where id=p_id;
 if p_status='approved' and d.ticket_status='unpaid' then
 update public.tickets set status='cancelled' where id=d.ticket_id;
 insert into public.ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason,approver_id) values(d.ticket_id,'unpaid','cancelled',p_actor,'Dispute approved: '||p_notes,p_actor);
 end if;
 return jsonb_build_object('dispute',to_jsonb(d));
end; $$;

create or replace function public.tvtms_dispute_list(p_status text,p_ticket_id bigint,p_actor bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) from (
 select d.*,t.ticket_number,td.plate_number,td.owner_name,td.owner_email,coalesce(s.name,d.contact_name,'Public User') submitted_by_name,r.name resolved_by_name
 from public.disputes d join public.tickets t on t.id=d.ticket_id join public.ticket_details td on td.id=t.id left join public.users s on s.id=d.submitted_by left join public.users r on r.id=d.resolved_by
 where (p_status is null or d.status=p_status) and (p_ticket_id is null or d.ticket_id=p_ticket_id)
 and exists(select 1 from public.users a where a.id=p_actor and a.status='active' and (a.role='admin' or (a.role='apprehending_officer' and t.user_id=p_actor)))
 ) q;
$$;

create or replace function public.tvtms_public_dispute(p_ticket text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t record; deadline integer; dispute_id bigint;
begin
 if coalesce(length(p_ticket),0) not between 1 and 30 or coalesce(length(trim(p_reason)),0) not between 10 and 4000 then return jsonb_build_object('errorCode','VALIDATION_ERROR','message','Invalid ticket number or dispute reason.','statusCode',400); end if;
 select ti.*,coalesce(nullif(ti.owner_name_at_issue,''),nullif(v.owner_name,'')) contact_name,coalesce(nullif(ti.owner_email_at_issue,''),nullif(v.owner_email,'')) contact_email into t from public.tickets ti join public.vehicles v on v.id=ti.vehicle_id where ti.ticket_number=p_ticket for update of ti;
 if not found then return jsonb_build_object('errorCode','TICKET_NOT_FOUND','message','Ticket not found.','statusCode',404); end if;
 if t.status<>'unpaid' then return jsonb_build_object('errorCode','INVALID_TICKET_STATUS','message','Only unpaid tickets can be disputed.','statusCode',403); end if;
 select coalesce((select setting_value::integer from public.system_settings where setting_key='dispute_deadline_days'),15) into deadline;
 if (current_timestamp at time zone 'UTC')::date-t.date_issued>deadline then return jsonb_build_object('errorCode','DISPUTE_DEADLINE_EXPIRED','message','The '||deadline||'-day dispute period has ended.','statusCode',403); end if;
 if exists(select 1 from public.disputes where ticket_id=t.id and status in ('submitted','under_review')) then return jsonb_build_object('errorCode','DISPUTE_ALREADY_EXISTS','message','A dispute is already open for this ticket.','statusCode',409); end if;
 insert into public.disputes(ticket_id,submitted_by,contact_name,contact_email,submission_source,reason,status) values(t.id,null,t.contact_name,t.contact_email,'public',p_reason,'submitted') returning id into dispute_id;
 insert into public.notifications(user_id,type,title,message,reference_type,reference_id) select id,'dispute','Public Dispute Filed','Public dispute filed for ticket '||p_ticket,'dispute',dispute_id from public.users where role='admin' and status='active';
 return jsonb_build_object('disputeId',dispute_id);
end; $$;

create or replace function public.tvtms_public_contact(p_name text,p_email text,p_subject text,p_message text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare contact_id bigint; admins bigint[];
begin
 if coalesce(length(p_name),0) not between 1 and 120 or coalesce(length(p_email),0) not between 1 and 190 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or coalesce(length(p_subject),0) not between 1 and 150 or coalesce(length(p_message),0) not between 10 and 3000 then return jsonb_build_object('errorCode','VALIDATION_ERROR','message','Invalid contact details.','statusCode',400); end if;
 select array_agg(a.id) into admins from (select id from public.users where role='admin' and status='active' for share) a;
 if coalesce(cardinality(admins),0)=0 then return jsonb_build_object('errorCode','NO_ADMIN','message','No active Administrator is available to receive the message. Please use the published hotline.','statusCode',503); end if;
 insert into public.contact_messages(full_name,email,subject,message) values(p_name,p_email,p_subject,p_message) returning id into contact_id;
 insert into public.notifications(user_id,type,title,message,reference_type,reference_id) select id,'contact','Public Contact Message','From: '||p_name||' <'||p_email||'>'||chr(10)||'Subject: '||p_subject||chr(10)||'Message: '||p_message,'contact',contact_id from unnest(admins) id;
 return jsonb_build_object('contactId',contact_id);
end; $$;

create or replace function public.tvtms_public_lookup(p_plate text,p_ticket text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q) order by q.date_issued desc,q.time_issued desc),'[]'::jsonb) from (
 select td.id,td.ticket_number,td.plate_number,td.vehicle_type,td.violation_code,td.violation_name,td.date_issued,td.time_issued,td.location,td.status,td.payment_date,td.demerit_points,td.penalty_amount,
 coalesce((select setting_value::integer from public.system_settings where setting_key='dispute_deadline_days'),15) dispute_deadline_days,
 current_date-td.date_issued dispute_age_days,
 case when exists(select 1 from public.disputes d where d.ticket_id=td.id and d.status in ('submitted','under_review')) then 1 else 0 end has_open_dispute,
 coalesce(p.total,0) total_paid,greatest(td.penalty_amount-coalesce(p.total,0),0) remaining_balance
 from public.ticket_details td left join lateral (select sum(amount_paid) total from public.payments where ticket_id=td.id and payment_status<>'voided') p on true
 where (p_plate is not null or p_ticket is not null) and (p_plate is null or replace(replace(td.plate_number,'-',''),' ','')=p_plate) and (p_ticket is null or td.ticket_number=p_ticket)
 order by td.date_issued desc,td.time_issued desc limit 20) q;
$$;

create or replace function public.tvtms_public_vehicle(p_plate text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('vehicles',coalesce((select jsonb_agg(to_jsonb(v)) from (select plate_number,vehicle_type from public.vehicles where replace(replace(plate_number,'-',''),' ','')=p_plate limit 1) v),'[]'::jsonb),
 'violations',coalesce((select jsonb_agg(to_jsonb(q)-'sort_time' order by q.date_issued desc,q.sort_time desc) from (
 select td.ticket_number,td.violation_name,td.violation_code,td.date_issued,td.status,td.penalty_amount,td.location,td.demerit_points,td.time_issued sort_time,coalesce(p.total,0) total_paid,greatest(td.penalty_amount-coalesce(p.total,0),0) remaining_balance
 from public.ticket_details td left join lateral (select sum(amount_paid) total from public.payments where ticket_id=td.id and payment_status<>'voided') p on true
 where replace(replace(td.plate_number,'-',''),' ','')=p_plate order by td.date_issued desc,td.time_issued desc limit 20) q),'[]'::jsonb));
$$;

create or replace function public.tvtms_public_summary(p_plate text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('total_violations',count(*) filter(where t.status<>'cancelled'),'unpaid_count',count(*) filter(where t.status='unpaid'),'paid_count',count(*) filter(where t.status='paid'),'cancelled_count',count(*) filter(where t.status='cancelled'),
 'total_unpaid_amount',coalesce(sum(case when t.status='unpaid' then greatest(coalesce(t.penalty_amount_at_issue,v.penalty_amount)-coalesce(p.total,0),0) else 0 end),0),
 'total_demerit_points',coalesce(sum(case when t.status<>'cancelled' then v.demerit_points else 0 end),0))
 from public.tickets t join public.vehicles ve on ve.id=t.vehicle_id join public.violations v on v.id=t.violation_id
 left join lateral (select sum(amount_paid) total from public.payments where ticket_id=t.id and payment_status<>'voided') p on true where replace(replace(ve.plate_number,'-',''),' ','')=p_plate;
$$;

create or replace function public.tvtms_public_stats()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('total_tickets',count(*),'total_paid',count(*) filter(where status='paid'),'total_unpaid',count(*) filter(where status='unpaid'),'today_tickets',count(*) filter(where date_issued=current_date),'this_month',count(*) filter(where date_issued>=current_date-interval '30 days'),'total_vehicles',(select count(*) from public.vehicles)) from public.tickets;
$$;

revoke all on function public.tvtms_payment_record(bigint,text,numeric,date,text,text,bigint),public.tvtms_dispute_create(bigint,text,bigint),public.tvtms_dispute_resolve(bigint,text,text,bigint),public.tvtms_dispute_list(text,bigint,bigint),public.tvtms_public_dispute(text,text),public.tvtms_public_contact(text,text,text,text),public.tvtms_public_lookup(text,text),public.tvtms_public_vehicle(text),public.tvtms_public_summary(text),public.tvtms_public_stats() from public,anon,authenticated;
grant execute on function public.tvtms_payment_record(bigint,text,numeric,date,text,text,bigint),public.tvtms_dispute_create(bigint,text,bigint),public.tvtms_dispute_resolve(bigint,text,text,bigint),public.tvtms_dispute_list(text,bigint,bigint),public.tvtms_public_dispute(text,text),public.tvtms_public_contact(text,text,text,text),public.tvtms_public_lookup(text,text),public.tvtms_public_vehicle(text),public.tvtms_public_summary(text),public.tvtms_public_stats() to service_role;

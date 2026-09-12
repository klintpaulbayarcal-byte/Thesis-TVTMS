-- Fixed ticket operations. Express validates the authenticated actor; browser
-- roles cannot execute these functions. Each mutation is one transaction.
create or replace function public.tvtms_ticket_error(p_code text, p_message text, p_status integer)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  select jsonb_build_object('error', jsonb_build_object('errorCode', p_code, 'message', p_message, 'statusCode', p_status));
$$;

create or replace function public.tvtms_ticket_list(p_filters jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with filtered as (
    select td.* from public.ticket_details td
    where (nullif(p_filters->>'status','') is null or td.status = p_filters->>'status')
      and (nullif(p_filters->>'dateFrom','') is null or td.date_issued >= (p_filters->>'dateFrom')::date)
      and (nullif(p_filters->>'dateTo','') is null or td.date_issued <= (p_filters->>'dateTo')::date)
      and (nullif(p_filters->>'enforcerId','') is null or td.user_id = (p_filters->>'enforcerId')::bigint)
      and (nullif(p_filters->>'officerId','') is null or td.user_id = (p_filters->>'officerId')::bigint)
      and (nullif(p_filters->>'violation','') is null or td.violation_name ilike '%' || (p_filters->>'violation') || '%' or td.violation_code ilike '%' || (p_filters->>'violation') || '%')
      and (nullif(p_filters->>'location','') is null or td.location ilike '%' || (p_filters->>'location') || '%')
      and (nullif(p_filters->>'search','') is null
        or td.ticket_number ilike '%' || (p_filters->>'search') || '%'
        or td.plate_number ilike '%' || (p_filters->>'search') || '%'
        or td.owner_name ilike '%' || (p_filters->>'search') || '%'
        or td.owner_email ilike '%' || (p_filters->>'search') || '%'
        or td.violation_name ilike '%' || (p_filters->>'search') || '%')
  ), sorted as (
    select * from filtered
    order by
      case when p_filters->>'sortOrder' = 'ASC' then
        case p_filters->>'sortBy' when 'time_issued' then time_issued::text when 'ticket_number' then ticket_number when 'status' then status when 'plate_number' then plate_number else date_issued::text end end asc,
      case when coalesce(p_filters->>'sortOrder','DESC') <> 'ASC' then
        case p_filters->>'sortBy' when 'time_issued' then time_issued::text when 'ticket_number' then ticket_number when 'status' then status when 'plate_number' then plate_number else date_issued::text end end desc,
      time_issued desc, id desc
    limit least(greatest(coalesce((p_filters->>'pageSize')::integer,20),1),100)
    offset greatest(coalesce((p_filters->>'offset')::integer,0),0)
  )
  select jsonb_build_object('tickets', coalesce((select jsonb_agg(to_jsonb(sorted)) from sorted),'[]'::jsonb), 'total', (select count(*) from filtered));
$$;

create or replace function public.tvtms_ticket_detail(p_id bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(td) || jsonb_build_object('timeline', coalesce((
    select jsonb_agg(to_jsonb(history) order by history.created_at,history.id)
    from (select h.id,h.previous_status,h.new_status,h.reason,h.created_at,u.name as changed_by_name
      from public.ticket_status_history h left join public.users u on u.id=h.changed_by
      where h.ticket_id=p_id) history
  ), '[]'::jsonb)) from public.ticket_details td where td.id=p_id;
$$;

create or replace function public.tvtms_ticket_stats(p_user_id bigint)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*), 'paid', count(*) filter(where t.status='paid'), 'unpaid', count(*) filter(where t.status='unpaid'),
    'repeatOffenders', count(*) filter(where t.status <> 'cancelled' and exists (
      select 1 from public.tickets previous where previous.vehicle_id=t.vehicle_id and previous.status <> 'cancelled'
      and (previous.date_issued<t.date_issued or (previous.date_issued=t.date_issued and previous.id<t.id)))),
    'revenue', (select coalesce(sum(p.amount_paid),0) from public.payments p join public.tickets rt on rt.id=p.ticket_id
      where p.payment_status <> 'voided' and (p_user_id is null or rt.user_id=p_user_id))
  ) from public.tickets t where p_user_id is null or t.user_id=p_user_id;
$$;

create or replace function public.tvtms_ticket_create(p_data jsonb, p_user_id bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_vehicle public.vehicles%rowtype;
  v_violation public.violations%rowtype;
  v_owner_id bigint;
  v_ticket public.tickets%rowtype;
  v_name text := nullif(p_data->>'owner_name','');
  v_email text := nullif(p_data->>'owner_email','');
  v_address text := nullif(p_data->>'owner_address','');
  v_plate text := p_data->>'plate_number';
  v_now timestamp := current_timestamp at time zone 'Asia/Manila';
  v_year smallint := extract(year from v_now)::smallint;
  v_number integer;
  v_offense integer;
  v_penalty numeric;
  v_rule boolean;
begin
  select * into v_violation from public.violations where id=(p_data->>'violation_id')::bigint for share;
  if not found or v_violation.status <> 'active' then
    return public.tvtms_ticket_error('VIOLATION_UNAVAILABLE','Selected violation is unavailable',400);
  end if;
  -- Also lock absent plate identities, so simultaneous first tickets cannot
  -- create duplicate vehicles or both choose first-offense penalties.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tvtms:plate:' || v_plate,0));
  if v_name is not null or v_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tvtms:owner:' || coalesce(v_email,v_name),0));
    if v_email is not null then
      select id into v_owner_id from public.owners where email=v_email order by id limit 1 for update;
    else
      select id into v_owner_id from public.owners where name=v_name order by id desc limit 1 for update;
    end if;
    if v_owner_id is null then
      insert into public.owners(name,email,address) values(coalesce(v_name,'Unknown Owner'),v_email,v_address) returning id into v_owner_id;
    else
      update public.owners set name=coalesce(v_name,name),email=coalesce(v_email,email),address=coalesce(v_address,address) where id=v_owner_id;
    end if;
  end if;
  select * into v_vehicle from public.vehicles
    where replace(replace(upper(plate_number),'-',''),' ','')=v_plate order by id limit 1 for update;
  if found then
    update public.vehicles set vehicle_type=p_data->>'vehicle_type',owner_name=coalesce(v_name,owner_name),
      owner_email=coalesce(v_email,owner_email),owner_address=coalesce(v_address,owner_address),owner_id=coalesce(v_owner_id,owner_id),
      driver_license_number=coalesce(nullif(p_data->>'driver_license_number',''),driver_license_number)
      where id=v_vehicle.id;
    v_name := coalesce(v_name,v_vehicle.owner_name);
    v_email := coalesce(v_email,v_vehicle.owner_email);
    v_address := coalesce(v_address,v_vehicle.owner_address);
  else
    insert into public.vehicles(plate_number,vehicle_type,owner_name,owner_email,owner_address,owner_id,driver_license_number)
      values(v_plate,p_data->>'vehicle_type',v_name,v_email,v_address,v_owner_id,nullif(p_data->>'driver_license_number','')) returning * into v_vehicle;
  end if;
  select count(*)+1 into v_offense from public.tickets t join public.vehicles v on v.id=t.vehicle_id
    where t.violation_id=v_violation.id and replace(replace(upper(v.plate_number),'-',''),' ','')=v_plate and t.status <> 'cancelled';
  select penalty_amount into v_penalty from public.violation_penalty_rules where violation_id=v_violation.id
    and offense_count=v_offense and is_active=1 and effective_from<=v_now::date and (effective_to is null or effective_to>=v_now::date)
    order by effective_from desc limit 1;
  v_rule := found;
  v_penalty := coalesce(v_penalty,v_violation.penalty_amount);
  insert into public.ticket_number_sequences(sequence_year,last_number) values(v_year,1)
    on conflict(sequence_year) do update set last_number=public.ticket_number_sequences.last_number+1,updated_at=current_timestamp
    returning last_number into v_number;
  insert into public.tickets(ticket_number,user_id,vehicle_id,violation_id,owner_name_at_issue,owner_email_at_issue,owner_address_at_issue,
    penalty_amount_at_issue,date_issued,time_issued,location,remarks)
    values('TVT-' || v_year || '-' || lpad(v_number::text,greatest(6,length(v_number::text)),'0'),p_user_id,v_vehicle.id,v_violation.id,
      v_name,v_email,v_address,v_penalty,v_now::date,v_now::time,nullif(p_data->>'location',''),nullif(p_data->>'remarks','')) returning * into v_ticket;
  insert into public.ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason) values
    (v_ticket.id,null,'draft',p_user_id,'Ticket drafted in system'),(v_ticket.id,'draft','issued',p_user_id,'Ticket was issued');
  return jsonb_build_object('ticket',(select to_jsonb(td) from public.ticket_details td where td.id=v_ticket.id),
    'penaltyInfo',jsonb_build_object('basePenalty',v_violation.penalty_amount,'effectivePenalty',v_penalty,'nextOffenseCount',v_offense,'usedEscalationRule',v_rule));
end;
$$;

create or replace function public.tvtms_ticket_mutate(p_action text,p_id bigint,p_user_id bigint,p_role text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_ticket public.tickets%rowtype;
  v_status text := p_data->>'status';
  v_reason text := nullif(p_data->>'reason','');
  v_current text;
  v_stored text;
  v_location text;
  v_remarks text;
  v_count integer;
  v_allowed boolean;
begin
  select * into v_ticket from public.tickets where id=p_id for update;
  if not found then return public.tvtms_ticket_error('TICKET_NOT_FOUND','Ticket not found',404); end if;
  if p_action in ('status','details') and p_role='apprehending_officer' and v_ticket.user_id<>p_user_id then
    return public.tvtms_ticket_error('TICKET_ACCESS_DENIED','Access denied',403);
  end if;
  if (p_action in ('cancel','delete','unpaid') or (p_action='status' and v_status in ('cancelled','voided','closed'))) and p_role<>'admin' then
    return public.tvtms_ticket_error('ADMIN_REQUIRED','Administrator approval is required for cancellation or closure',403);
  end if;
  if p_action='details' then
    if v_ticket.status in ('paid','cancelled') then return public.tvtms_ticket_error('INVALID_OPERATION','Paid or cancelled tickets cannot be edited',409); end if;
    v_location := nullif(btrim(coalesce(p_data->>'location',v_ticket.location,'')),'');
    v_remarks := nullif(btrim(coalesce(p_data->>'remarks',v_ticket.remarks,'')),'');
    if length(v_location)>200 or length(v_remarks)>4000 then return public.tvtms_ticket_error('VALIDATION_ERROR','Location or remarks exceed the allowed length',400); end if;
    update public.tickets set location=v_location,remarks=v_remarks where id=p_id;
    return jsonb_build_object('previous',to_jsonb(v_ticket),'location',v_location,'remarks',v_remarks);
  elsif p_action='delete' then
    if v_ticket.status not in ('unpaid','cancelled') then return public.tvtms_ticket_error('TICKET_DELETE_NOT_ALLOWED','Only unpaid or cancelled tickets can be permanently deleted',409); end if;
    if exists(select 1 from public.payments where ticket_id=p_id) or exists(select 1 from public.disputes where ticket_id=p_id) or exists(select 1 from public.evidence where ticket_id=p_id) then
      return public.tvtms_ticket_error('LINKED_RECORDS_EXIST','This ticket has linked payment, dispute, or evidence records and cannot be deleted',409);
    end if;
    delete from public.tickets where id=p_id;
    return jsonb_build_object('ticket',to_jsonb(v_ticket));
  elsif p_action='unpaid' then
    if v_ticket.status<>'paid' then return public.tvtms_ticket_error('TICKET_NOT_PAID','Only paid tickets can be marked unpaid',409); end if;
    update public.payments set payment_status='voided',notes=coalesce(notes,'') || case when coalesce(notes,'')='' then '' else E'\n' end || 'Voided because paid status was corrected: ' || coalesce(v_reason,'')
      where ticket_id=p_id and payment_status<>'voided';
    get diagnostics v_count = row_count;
    update public.tickets set status='unpaid' where id=p_id;
    insert into public.ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason,approver_id) values(p_id,'paid','unpaid',p_user_id,v_reason,p_user_id);
    return jsonb_build_object('ticket',to_jsonb(v_ticket),'voidedPayments',v_count);
  elsif p_action='cancel' then
    if v_ticket.status='paid' then return public.tvtms_ticket_error('INVALID_OPERATION','Paid tickets cannot be cancelled',409); end if;
    if v_ticket.status='cancelled' then return public.tvtms_ticket_error('ALREADY_CANCELLED','Ticket is already cancelled',409); end if;
    if (select coalesce(sum(amount_paid),0) from public.payments where ticket_id=p_id and payment_status<>'voided')>0 then
      return public.tvtms_ticket_error('PAYMENT_EXISTS','Tickets with recorded payments cannot be cancelled',409);
    end if;
    update public.tickets set status='cancelled' where id=p_id;
    insert into public.ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason,approver_id) values(p_id,v_ticket.status,'cancelled',p_user_id,v_reason,p_user_id);
    return jsonb_build_object('ticket',to_jsonb(v_ticket) || jsonb_build_object('status','cancelled'));
  elsif p_action='status' then
    if v_status='paid' then return public.tvtms_ticket_error('PAYMENT_REQUIRED','Record an official payment instead of changing the ticket status directly',409); end if;
    if v_status in ('cancelled','voided') and (select coalesce(sum(amount_paid),0) from public.payments where ticket_id=p_id and payment_status<>'voided')>0 then
      return public.tvtms_ticket_error('PAYMENT_EXISTS','Tickets with recorded payments cannot be cancelled or voided',409);
    end if;
    select new_status into v_current from public.ticket_status_history where ticket_id=p_id order by id desc limit 1;
    v_current := coalesce(v_current,case v_ticket.status when 'unpaid' then 'pending_payment' else v_ticket.status end);
    v_allowed := case v_current
      when 'draft' then v_status in ('issued','cancelled','voided')
      when 'issued' then v_status in ('pending_payment','partially_paid','paid','cancelled','voided')
      when 'pending_payment' then v_status in ('partially_paid','paid','cancelled','voided')
      when 'partially_paid' then v_status in ('partially_paid','paid','cancelled','voided')
      when 'unpaid' then v_status in ('pending_payment','partially_paid','paid','cancelled','voided')
      when 'paid' then v_status='closed' else false end;
    if not coalesce(v_allowed,false) then return public.tvtms_ticket_error('INVALID_STATUS_TRANSITION','Invalid lifecycle transition: ' || v_current || ' -> ' || coalesce(v_status,''),409); end if;
    v_stored := case when v_status in ('paid','closed') then 'paid' when v_status in ('cancelled','voided') then 'cancelled' else 'unpaid' end;
    update public.tickets set status=v_stored where id=p_id;
    insert into public.ticket_status_history(ticket_id,previous_status,new_status,changed_by,reason,approver_id) values(p_id,v_current,v_status,p_user_id,v_reason,p_user_id);
    return jsonb_build_object('previousLifecycleStatus',v_current,'storedStatus',v_stored);
  end if;
  return public.tvtms_ticket_error('INVALID_OPERATION','Unsupported ticket operation',400);
end;
$$;

revoke all on function public.tvtms_ticket_error(text,text,integer), public.tvtms_ticket_list(jsonb), public.tvtms_ticket_detail(bigint), public.tvtms_ticket_stats(bigint), public.tvtms_ticket_create(jsonb,bigint), public.tvtms_ticket_mutate(text,bigint,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.tvtms_ticket_error(text,text,integer), public.tvtms_ticket_list(jsonb), public.tvtms_ticket_detail(bigint), public.tvtms_ticket_stats(bigint), public.tvtms_ticket_create(jsonb,bigint), public.tvtms_ticket_mutate(text,bigint,bigint,text,jsonb) to service_role;

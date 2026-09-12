-- Fixed backend-only account and catalog operations. No dynamic SQL gateway.
CREATE OR REPLACE FUNCTION public.tvtms_account_failed_login(p_id bigint, p_max_attempts integer, p_lock_minutes integer)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE public.users SET failed_login_attempts = failed_login_attempts + 1,
    locked_until = CASE WHEN failed_login_attempts + 1 >= p_max_attempts
      THEN CURRENT_TIMESTAMP + pg_catalog.make_interval(mins => p_lock_minutes) ELSE NULL END
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_account_reset_password(p_id bigint, p_token_hash text, p_password text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.users SET password = p_password, reset_token_hash = NULL, reset_token_expires = NULL,
    failed_login_attempts = 0, locked_until = NULL
  WHERE id = p_id AND reset_token_hash = p_token_hash AND reset_token_expires > CURRENT_TIMESTAMP;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_account_update(p_id bigint, p_name text, p_email text, p_role text, p_contact text, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE account public.users%ROWTYPE;
BEGIN
  -- Serialize administrator removals before taking any row lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(84621, 1);
  SELECT * INTO account FROM public.users WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error', 'User not found', 'status', 404); END IF;
  IF account.role = 'admin' AND (p_role <> 'admin' OR p_status <> 'active')
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE role = 'admin' AND status = 'active' AND id <> p_id) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'At least one active administrator must remain.', 'status', 409);
  END IF;
  UPDATE public.users SET name = p_name, email = p_email, role = p_role, contact_number = p_contact, status = p_status WHERE id = p_id;
  RETURN '{}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_account_delete(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE account public.users%ROWTYPE; labels text[] := ARRAY[]::text[]; n bigint;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(84621, 1);
  SELECT * INTO account FROM public.users WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error', 'User not found', 'status', 404); END IF;
  IF account.role = 'admin' AND account.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.users WHERE role = 'admin' AND status = 'active' AND id <> p_id) THEN
    RETURN pg_catalog.jsonb_build_object('error', 'At least one active administrator must remain.', 'status', 409);
  END IF;
  SELECT count(*) INTO n FROM public.tickets WHERE user_id = p_id;
  IF n > 0 THEN labels := pg_catalog.array_append(labels, n || ' ticket' || CASE WHEN n = 1 THEN '' ELSE 's' END); END IF;
  SELECT count(*) INTO n FROM public.ticket_status_history WHERE changed_by = p_id OR approver_id = p_id;
  IF n > 0 THEN labels := pg_catalog.array_append(labels, n || ' ticket status change' || CASE WHEN n = 1 THEN '' ELSE 's' END); END IF;
  SELECT count(*) INTO n FROM public.payments WHERE recorded_by = p_id;
  IF n > 0 THEN labels := pg_catalog.array_append(labels, n || ' payment' || CASE WHEN n = 1 THEN '' ELSE 's' END); END IF;
  SELECT count(*) INTO n FROM public.disputes WHERE submitted_by = p_id OR resolved_by = p_id;
  IF n > 0 THEN labels := pg_catalog.array_append(labels, n || ' dispute' || CASE WHEN n = 1 THEN '' ELSE 's' END); END IF;
  SELECT count(*) INTO n FROM public.evidence WHERE uploaded_by = p_id;
  IF n > 0 THEN labels := pg_catalog.array_append(labels, n || ' evidence record' || CASE WHEN n = 1 THEN '' ELSE 's' END); END IF;
  IF pg_catalog.cardinality(labels) > 0 THEN
    RETURN pg_catalog.jsonb_build_object('error', 'This account cannot be permanently deleted because it is linked to ' || pg_catalog.array_to_string(labels, ', ') || '. Deactivate it instead to preserve historical records.', 'status', 409);
  END IF;
  DELETE FROM public.users WHERE id = p_id;
  RETURN pg_catalog.jsonb_build_object('user', pg_catalog.jsonb_build_object('id',account.id,'name',account.name,'email',account.email,'role',account.role));
END;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_account_provision_admin(p_email text, p_name text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE account public.users%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(84621, 1);
  SELECT * INTO account FROM public.users WHERE email = p_email FOR UPDATE;
  IF FOUND THEN
    IF account.role <> 'admin' THEN
      RETURN pg_catalog.jsonb_build_object('error', 'Administrator provisioning stopped: the configured email belongs to role "' || account.role || '". The existing account was not modified; choose a different Administrator email.');
    END IF;
    UPDATE public.users SET password = p_password, name = COALESCE(p_name, name), status = 'active',
      failed_login_attempts = 0, locked_until = NULL, reset_token_hash = NULL, reset_token_expires = NULL
    WHERE id = account.id;
    RETURN pg_catalog.jsonb_build_object('status', 'UPDATED');
  END IF;
  INSERT INTO public.users(name,email,password,role,status) VALUES(COALESCE(p_name,'System Administrator'),p_email,p_password,'admin','active');
  RETURN pg_catalog.jsonb_build_object('status', 'CREATED');
END;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_account_clear_test_logs()
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE deleted bigint;
BEGIN
  DELETE FROM public.audit_logs WHERE action ILIKE 'TEST_%';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_catalog_vehicle_by_plate(p_plate text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(r), '[]'::jsonb) FROM (
    SELECT id,plate_number,vehicle_type,owner_name,owner_email,owner_address,driver_license_number
    FROM public.vehicles WHERE replace(replace(upper(plate_number), '-', ''), ' ', '') = p_plate LIMIT 1
  ) r;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_catalog_vehicle_violations(p_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(r ORDER BY r.date_issued DESC, r.id), '[]'::jsonb) FROM (
    SELECT t.id,t.ticket_number,t.date_issued,t.location,t.status,
      COALESCE(t.penalty_amount_at_issue,v.penalty_amount) AS penalty_amount,
      COALESCE(p.total,0) AS total_paid,
      GREATEST(COALESCE(t.penalty_amount_at_issue,v.penalty_amount)-COALESCE(p.total,0),0) AS remaining_balance,
      v.violation_name,v.violation_code,v.demerit_points
    FROM public.tickets t LEFT JOIN public.violations v ON t.violation_id=v.id
    LEFT JOIN LATERAL (SELECT sum(amount_paid) AS total FROM public.payments WHERE ticket_id=t.id AND payment_status<>'voided') p ON true
    WHERE t.vehicle_id=p_id
  ) r;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_catalog_search_vehicles(p_license text, p_owner text, p_query text, p_type text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) - 'sort_key' ORDER BY r.sort_key, r.id), '[]'::jsonb) FROM (
    SELECT v.id,v.plate_number,v.vehicle_type,v.owner_name,v.owner_email,v.driver_license_number,
      (SELECT count(*) FROM public.tickets t WHERE t.vehicle_id=v.id) AS violation_count,
      CASE WHEN p_license IS NULL AND p_owner IS NOT NULL THEN v.owner_name ELSE v.plate_number END AS sort_key
    FROM public.vehicles v
    WHERE CASE WHEN p_license IS NOT NULL THEN v.driver_license_number=p_license
      WHEN p_owner IS NOT NULL THEN v.owner_name ILIKE '%' || p_owner || '%'
      ELSE (upper(v.plate_number) LIKE '%' || upper(p_query) || '%' OR v.owner_name ILIKE '%' || p_query || '%' OR v.owner_email ILIKE '%' || p_query || '%') END
      AND (p_license IS NOT NULL OR p_type='all' OR v.vehicle_type=p_type)
    ORDER BY sort_key,v.id LIMIT 20
  ) r;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_catalog_vehicle_stats(p_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object('total_violations',count(*),
    'paid_count',count(*) FILTER (WHERE t.status='paid'), 'unpaid_count',count(*) FILTER (WHERE t.status='unpaid'),
    'cancelled_count',count(*) FILTER (WHERE t.status='cancelled'),
    'disputed_count',count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.disputes d WHERE d.ticket_id=t.id AND d.status IN ('submitted','under_review'))),
    'outstanding_balance',COALESCE(sum(CASE WHEN t.status='unpaid' THEN GREATEST(COALESCE(t.penalty_amount_at_issue,v.penalty_amount)-COALESCE(p.total,0),0) ELSE 0 END),0))
  FROM public.tickets t JOIN public.violations v ON t.violation_id=v.id
  LEFT JOIN LATERAL (SELECT sum(amount_paid) AS total FROM public.payments WHERE ticket_id=t.id AND payment_status<>'voided') p ON true
  WHERE t.vehicle_id=p_id;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_catalog_prior_offenses(p_id bigint, p_plate text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT pg_catalog.jsonb_build_object('prior_count',count(*)) FROM public.tickets t JOIN public.vehicles v ON t.vehicle_id=v.id
  WHERE t.violation_id=p_id AND replace(replace(upper(v.plate_number),'-',''),' ','')=p_plate AND t.status<>'cancelled';
$$;

CREATE OR REPLACE FUNCTION public.tvtms_catalog_penalty_rule(p_id bigint, p_offense integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(r), '[]'::jsonb) FROM (
    SELECT penalty_amount FROM public.violation_penalty_rules WHERE violation_id=p_id AND offense_count=p_offense
      AND is_active=1 AND effective_from<=CURRENT_DATE AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)
    ORDER BY effective_from DESC LIMIT 1
  ) r;
$$;

CREATE OR REPLACE FUNCTION public.tvtms_catalog_delete_violation(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.violations WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','Violation not found','status',404); END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE violation_id=p_id) THEN
    RETURN pg_catalog.jsonb_build_object('error','Cannot delete this violation because it is already used in existing tickets. Set it to inactive instead.','status',409);
  END IF;
  DELETE FROM public.violations WHERE id=p_id;
  RETURN '{}'::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.tvtms_account_failed_login(bigint, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_account_failed_login(bigint, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_account_reset_password(bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_account_reset_password(bigint, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_account_update(bigint, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_account_update(bigint, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_account_delete(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_account_delete(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_account_provision_admin(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_account_provision_admin(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_account_clear_test_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_account_clear_test_logs() TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_catalog_vehicle_by_plate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_catalog_vehicle_by_plate(text) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_catalog_vehicle_violations(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_catalog_vehicle_violations(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_catalog_search_vehicles(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_catalog_search_vehicles(text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_catalog_vehicle_stats(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_catalog_vehicle_stats(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_catalog_prior_offenses(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_catalog_prior_offenses(bigint, text) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_catalog_penalty_rule(bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_catalog_penalty_rule(bigint, integer) TO service_role;

REVOKE ALL ON FUNCTION public.tvtms_catalog_delete_violation(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tvtms_catalog_delete_violation(bigint) TO service_role;

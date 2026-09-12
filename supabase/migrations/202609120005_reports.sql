-- Fixed read-only report functions; inputs are values, never executable SQL.

create or replace function public.tvtms_report_revenue(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT COALESCE(SUM(amount_paid), 0) AS total
         FROM public.payments
         WHERE DATE(payment_date) BETWEEN (p_args->>0)::date AND (p_args->>1)::date
           AND payment_status <> 'voided'
    ) report_row;
$report$;
revoke all on function public.tvtms_report_revenue(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_revenue(jsonb) to service_role;

create or replace function public.tvtms_report_daily_tickets(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT * FROM public.ticket_details WHERE date_issued = (p_args->>0)::date ORDER BY time_issued DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_daily_tickets(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_daily_tickets(jsonb) to service_role;

create or replace function public.tvtms_report_monthly_tickets(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT * FROM public.ticket_details
             WHERE EXTRACT(YEAR FROM date_issued) = (p_args->>0)::integer AND EXTRACT(MONTH FROM date_issued) = (p_args->>1)::integer
             ORDER BY date_issued DESC, time_issued DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_monthly_tickets(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_monthly_tickets(jsonb) to service_role;

create or replace function public.tvtms_report_daily_revenue(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT DATE(payment_date) AS collection_date, COALESCE(SUM(amount_paid), 0) AS revenue
             FROM public.payments
             WHERE DATE(payment_date) BETWEEN (p_args->>0)::date AND (p_args->>1)::date AND payment_status <> 'voided'
             GROUP BY DATE(payment_date)
    ) report_row;
$report$;
revoke all on function public.tvtms_report_daily_revenue(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_daily_revenue(jsonb) to service_role;

create or replace function public.tvtms_report_yearly_tickets(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT * FROM public.ticket_details WHERE EXTRACT(YEAR FROM date_issued) = (p_args->>0)::integer ORDER BY date_issued DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_yearly_tickets(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_yearly_tickets(jsonb) to service_role;

create or replace function public.tvtms_report_yearly_revenue(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT EXTRACT(MONTH FROM payment_date) AS month_number, COALESCE(SUM(amount_paid), 0) AS revenue
             FROM public.payments
             WHERE EXTRACT(YEAR FROM payment_date) = (p_args->>0)::integer AND payment_status <> 'voided'
             GROUP BY EXTRACT(MONTH FROM payment_date)
    ) report_row;
$report$;
revoke all on function public.tvtms_report_yearly_revenue(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_yearly_revenue(jsonb) to service_role;

create or replace function public.tvtms_report_range_tickets(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT * FROM public.ticket_details
             WHERE date_issued BETWEEN (p_args->>0)::date AND (p_args->>1)::date
             ORDER BY date_issued DESC, time_issued DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_range_tickets(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_range_tickets(jsonb) to service_role;

create or replace function public.tvtms_report_violation_stats(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT 
                v.violation_name,
                v.violation_code,
                COUNT(t.id) as count,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                COALESCE(SUM(p.total_paid), 0) as total_revenue
            FROM public.violations v
            LEFT JOIN public.tickets t ON v.id = t.violation_id
            LEFT JOIN (
                SELECT ticket_id, SUM(amount_paid) AS total_paid
                FROM public.payments
                WHERE payment_status <> 'voided'
                GROUP BY ticket_id
            ) p ON p.ticket_id = t.id
            GROUP BY v.id, v.violation_name, v.violation_code
            ORDER BY count DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_violation_stats(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_violation_stats(jsonb) to service_role;

create or replace function public.tvtms_report_officer_period(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT
                u.id,
                u.name,
                COUNT(t.id) AS total_tickets,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) AS paid_tickets,
                SUM(CASE WHEN t.status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_tickets,
                COALESCE(SUM(p.total_paid), 0) AS total_revenue
            FROM public.users u
            LEFT JOIN public.tickets t
                ON u.id = t.user_id
               AND t.date_issued BETWEEN (p_args->>0)::date AND (p_args->>1)::date
            LEFT JOIN (
                SELECT ticket_id, SUM(amount_paid) AS total_paid
                FROM public.payments
                WHERE payment_status <> 'voided'
                GROUP BY ticket_id
            ) p ON p.ticket_id = t.id
            WHERE u.role = 'apprehending_officer'
              AND u.status = 'active'
            GROUP BY u.id, u.name
            ORDER BY total_tickets DESC, u.name ASC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_officer_period(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_officer_period(jsonb) to service_role;

create or replace function public.tvtms_report_daily_collections(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT DATE(p.payment_date) as collection_date,
                    COUNT(*) as payment_count,
                    SUM(p.amount_paid) as total_collected
             FROM public.payments p
             WHERE DATE(p.payment_date) BETWEEN (p_args->>0)::date AND (p_args->>1)::date
               AND p.payment_status <> 'voided'
             GROUP BY DATE(p.payment_date)
             ORDER BY DATE(p.payment_date) DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_daily_collections(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_daily_collections(jsonb) to service_role;

create or replace function public.tvtms_report_collections_summary(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT COALESCE(SUM(p.amount_paid), 0) as total_collected,
                    COUNT(*) as payment_count,
                    COUNT(DISTINCT p.ticket_id) as settled_tickets
             FROM public.payments p
             WHERE DATE(p.payment_date) BETWEEN (p_args->>0)::date AND (p_args->>1)::date
               AND p.payment_status <> 'voided'
    ) report_row;
$report$;
revoke all on function public.tvtms_report_collections_summary(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_collections_summary(jsonb) to service_role;

create or replace function public.tvtms_report_hotspots(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT
                COALESCE(NULLIF(TRIM(location), ''), 'Unspecified') as location,
                COUNT(*) as total_violations,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) as unpaid_count
             FROM public.tickets
             WHERE date_issued BETWEEN (p_args->>0)::date AND (p_args->>1)::date
             GROUP BY COALESCE(NULLIF(TRIM(location), ''), 'Unspecified')
             ORDER BY total_violations DESC
             LIMIT 20
    ) report_row;
$report$;
revoke all on function public.tvtms_report_hotspots(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_hotspots(jsonb) to service_role;

create or replace function public.tvtms_report_settings(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT setting_key, setting_value FROM public.system_settings
             WHERE setting_key IN ('lgu_name','lgu_address','lgu_contact','system_title')
    ) report_row;
$report$;
revoke all on function public.tvtms_report_settings(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_settings(jsonb) to service_role;

create or replace function public.tvtms_report_collections_chart(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT DATE(p.payment_date) as date,
                    SUM(p.amount_paid) as amount
             FROM public.payments p
             WHERE DATE(p.payment_date) BETWEEN (p_args->>0)::date AND (p_args->>1)::date
               AND p.payment_status <> 'voided'
             GROUP BY DATE(p.payment_date)
             ORDER BY DATE(p.payment_date)
    ) report_row;
$report$;
revoke all on function public.tvtms_report_collections_chart(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_collections_chart(jsonb) to service_role;

create or replace function public.tvtms_report_collection_totals(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT COALESCE(SUM(p.amount_paid), 0) AS "totalAmount",
                    COUNT(*) AS "paymentCount"
             FROM public.payments p
             WHERE DATE(p.payment_date) BETWEEN (p_args->>0)::date AND (p_args->>1)::date
               AND p.payment_status <> 'voided'
    ) report_row;
$report$;
revoke all on function public.tvtms_report_collection_totals(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_collection_totals(jsonb) to service_role;

create or replace function public.tvtms_report_payment_status(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT 
                t.status,
                COUNT(*) as count,
                COALESCE(SUM(CASE WHEN t.status = 'paid' THEN COALESCE(t.penalty_amount_at_issue, v.penalty_amount) ELSE COALESCE(t.penalty_amount_at_issue, v.penalty_amount) END), 0) as amount
             FROM public.tickets t
             LEFT JOIN public.violations v ON t.violation_id = v.id
             WHERE t.date_issued BETWEEN (p_args->>0)::date AND (p_args->>1)::date
             GROUP BY t.status
    ) report_row;
$report$;
revoke all on function public.tvtms_report_payment_status(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_payment_status(jsonb) to service_role;

create or replace function public.tvtms_report_open_disputes(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT COUNT(DISTINCT d.ticket_id) AS disputed
             FROM public.disputes d
             JOIN public.tickets t ON d.ticket_id = t.id
             WHERE t.date_issued BETWEEN (p_args->>0)::date AND (p_args->>1)::date
               AND d.status IN ('submitted', 'under_review')
    ) report_row;
$report$;
revoke all on function public.tvtms_report_open_disputes(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_open_disputes(jsonb) to service_role;

create or replace function public.tvtms_report_ticket_totals(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT COUNT(*) AS "totalIssued",
                    SUM(CASE WHEN status = 'unpaid' THEN 1 ELSE 0 END) AS "pendingPayment"
             FROM public.tickets
             WHERE date_issued BETWEEN (p_args->>0)::date AND (p_args->>1)::date
    ) report_row;
$report$;
revoke all on function public.tvtms_report_ticket_totals(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_ticket_totals(jsonb) to service_role;

create or replace function public.tvtms_report_top_violations(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT v.violation_name, COUNT(*) as count
             FROM public.tickets t
             LEFT JOIN public.violations v ON t.violation_id = v.id
             WHERE t.date_issued BETWEEN (p_args->>0)::date AND (p_args->>1)::date
             GROUP BY v.id, v.violation_name
             ORDER BY count DESC
             LIMIT 10
    ) report_row;
$report$;
revoke all on function public.tvtms_report_top_violations(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_top_violations(jsonb) to service_role;

create or replace function public.tvtms_report_dispute_rate(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT COUNT(*) AS "totalDisputes",
                    SUM(CASE WHEN status IN ('approved', 'rejected', 'closed') THEN 1 ELSE 0 END) AS "resolvedCount"
             FROM public.disputes
             WHERE DATE(created_at) BETWEEN (p_args->>0)::date AND (p_args->>1)::date
    ) report_row;
$report$;
revoke all on function public.tvtms_report_dispute_rate(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_dispute_rate(jsonb) to service_role;

create or replace function public.tvtms_report_monthly_revenue(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT TO_CHAR(p.payment_date, 'YYYY-MM') as month,
                    SUM(p.amount_paid) AS "totalAmount"
             FROM public.payments p
             WHERE p.payment_status <> 'voided'
             GROUP BY TO_CHAR(p.payment_date, 'YYYY-MM')
             ORDER BY month DESC
             LIMIT 12
    ) report_row;
$report$;
revoke all on function public.tvtms_report_monthly_revenue(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_monthly_revenue(jsonb) to service_role;

create or replace function public.tvtms_report_officer_performance(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT
                u.id,
                u.name AS officer_name,
                u.contact_number,
                COUNT(t.id) AS total_tickets,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) AS paid_tickets,
                SUM(CASE WHEN t.status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid_tickets,
                SUM(CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_tickets,
                ROUND(
                    100.0 * SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) /
                    NULLIF(COUNT(CASE WHEN t.status != 'cancelled' THEN 1 END), 0),
                2) AS collection_rate_pct,
                SUM(COALESCE(t.penalty_amount_at_issue, viol.penalty_amount)) AS total_value,
                MIN(t.date_issued) AS first_ticket_date,
                MAX(t.date_issued) AS latest_ticket_date
            FROM public.users u
            LEFT JOIN public.tickets t ON t.user_id = u.id
            LEFT JOIN public.violations viol ON t.violation_id = viol.id
            WHERE u.role = 'apprehending_officer' AND u.status = 'active'
            GROUP BY u.id, u.name, u.contact_number
            ORDER BY total_tickets DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_officer_performance(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_officer_performance(jsonb) to service_role;

create or replace function public.tvtms_report_aging(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT
                v.plate_number,
                v.vehicle_type,
                v.owner_name,
                v.owner_email,
                COUNT(t.id) AS unpaid_tickets,
                SUM(COALESCE(t.penalty_amount_at_issue, viol.penalty_amount)) AS total_due,
                MIN(t.date_issued) AS oldest_unpaid_date,
                (CURRENT_DATE - MIN(t.date_issued)::date) AS days_overdue,
                CASE
                    WHEN (CURRENT_DATE - MIN(t.date_issued)::date) <= 30 THEN '0-30 days'
                    WHEN (CURRENT_DATE - MIN(t.date_issued)::date) <= 60 THEN '31-60 days'
                    ELSE '60+ days (critical)'
                END AS aging_bucket
            FROM public.tickets t
            JOIN public.vehicles v ON t.vehicle_id = v.id
            JOIN public.violations viol ON t.violation_id = viol.id
            WHERE t.status = 'unpaid'
            GROUP BY v.plate_number, v.vehicle_type, v.owner_name, v.owner_email
            ORDER BY days_overdue DESC
    ) report_row;
$report$;
revoke all on function public.tvtms_report_aging(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_aging(jsonb) to service_role;

create or replace function public.tvtms_report_barangay(p_args jsonb default '[]'::jsonb)
returns jsonb language sql stable security invoker
set search_path = ''
set timezone = 'Asia/Manila'
as $report$
    select coalesce(jsonb_agg(to_jsonb(report_row)), '[]'::jsonb) from (
SELECT
                TRIM(REGEXP_REPLACE(LOWER(t.location), '^.*,', '')) AS barangay,
                COUNT(*) AS total_tickets,
                SUM(CASE WHEN t.status = 'paid' THEN 1 ELSE 0 END) AS paid,
                SUM(CASE WHEN t.status = 'unpaid' THEN 1 ELSE 0 END) AS unpaid,
                SUM(COALESCE(t.penalty_amount_at_issue, viol.penalty_amount)) AS total_value,
                STRING_AGG(DISTINCT viol.violation_name, ', ' ORDER BY viol.violation_name) AS top_violations
            FROM public.tickets t
            JOIN public.violations viol ON t.violation_id = viol.id
            WHERE t.location IS NOT NULL AND t.location != ''
            GROUP BY barangay
            ORDER BY total_tickets DESC
            LIMIT 30
    ) report_row;
$report$;
revoke all on function public.tvtms_report_barangay(jsonb) from public, anon, authenticated;
grant execute on function public.tvtms_report_barangay(jsonb) to service_role;

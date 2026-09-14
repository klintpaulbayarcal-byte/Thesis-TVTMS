-- The Express server is the authorization boundary. Browser roles stay denied.
grant usage on schema public, private to service_role;
grant select, insert, update, delete on table
    public.users, public.owners, public.vehicles, public.violations,
    public.violation_penalty_rules, public.tickets, public.ticket_number_sequences,
    public.ticket_status_history, public.payments, public.disputes, public.evidence,
    public.notifications, public.contact_messages, public.audit_logs,
    public.system_settings to service_role;
grant select on public.ticket_details, public.daily_stats to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function private.set_updated_at() to service_role;

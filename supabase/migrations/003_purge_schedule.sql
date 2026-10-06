-- الحذف التلقائي لسجل الطلبات بعد 30 يوماً (وفق PRIVACY.md) — يومياً الساعة 3 صباحاً UTC
create extension if not exists pg_cron;
select cron.schedule('manhal-purge-old-requests', '0 3 * * *', $$select public.purge_old_requests(30)$$);

-- منهل: مواءمة مع الحزمة العلمية للتحدي (4 أكتوبر 2026)
-- 1) التخريج (attribution) لأحاديث موسوعة الأحاديث النبوية HadeethEnc
-- 2) الخصوصية: حذف السجلات القديمة تلقائياً

alter table hadith add column if not exists attribution text;

drop function if exists get_hadiths(text[], text);
create or replace function get_hadiths(ids text[], lang text default 'ar')
returns table (id text, collection text, number text, text_ar text, grades jsonb, attribution text,
               translation text, explanation text, source_id text)
language sql stable as $$
  select h.id, h.collection, h.number, h.text_ar, h.grades, h.attribution, tr.text, tr.explanation, h.source_id
  from hadith h
  left join lateral (
    select x.text, x.explanation from hadith_translations x
    where x.hadith_id = h.id and x.lang = get_hadiths.lang limit 1
  ) tr on true
  where h.id = any(ids)
$$;

-- سياسة الاحتفاظ: السجلات تُحذف بعد 30 يوماً (افتراضياً).
-- جدولها يومياً عبر pg_cron:  select cron.schedule('purge-requests', '0 3 * * *', 'select purge_old_requests()');
create or replace function purge_old_requests(days int default 30) returns int
language sql as $$
  with d as (delete from requests where created_at < now() - make_interval(days => days) returning 1)
  select count(*)::int from d
$$;

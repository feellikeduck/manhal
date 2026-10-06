-- منهل: قاعدة البيانات
-- شغّله مرة وحدة في Supabase > SQL Editor (أو: supabase db push)

create extension if not exists vector;
create extension if not exists pg_trgm;

-- توحيد النص العربي (نفس منطق lib/normalize.ts بالضبط):
-- حذف التشكيل وعلامات المصحف والتطويل، توحيد الألف والياء والتاء المربوطة، وحذف الترقيم
create or replace function normalize_ar(t text) returns text
language sql immutable parallel safe as $$
  select trim(regexp_replace(regexp_replace(
    translate(
      regexp_replace(coalesce(t, ''), '[\u064B-\u065F\u0670\u0640\u06D6-\u06ED\u08D3-\u08FF\u200C-\u200F]', '', 'g'),
      'ٱأإآىیةؤئ', 'ااااييهوي'),
    '[^\u0621-\u064A0-9a-zA-Z[:space:]]', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'))
$$;

-- ========== المصادر وتراخيصها ==========
create table sources (
  id text primary key,
  name text not null,
  url text not null,
  license text not null,
  version text,
  fetched_at timestamptz default now()
);

-- ========== القرآن ==========
-- text: الرسم العثماني للعرض. text_simple: الإملائي للبحث والمطابقة
create table quran_ayat (
  surah int not null,
  ayah int not null,
  text text not null,
  text_simple text not null,
  text_norm text generated always as (normalize_ar(text_simple)) stored,
  source_id text references sources(id),
  primary key (surah, ayah)
);

create table quran_translations (
  surah int not null,
  ayah int not null,
  lang text not null,
  text text not null,
  source_id text not null references sources(id),
  primary key (surah, ayah, lang, source_id)
);

create table tafsir (
  surah int not null,
  ayah int not null,
  text text not null,
  source_id text not null references sources(id),
  primary key (surah, ayah, source_id)
);

-- ========== الحديث ==========
-- id بصيغة collection:number مثل bukhari:1
-- grades: [{"grader": "...", "grade": "..."}] كما وردت في المصدر، بلا حكم من منهل
create table hadith (
  id text primary key,
  collection text not null,
  number text not null,
  text_ar text not null,
  text_norm text generated always as (normalize_ar(text_ar)) stored,
  grades jsonb not null default '[]',
  source_id text references sources(id)
);

create table hadith_translations (
  hadith_id text references hadith(id) on delete cascade,
  lang text not null,
  text text not null,
  explanation text,
  source_id text not null references sources(id),
  primary key (hadith_id, lang, source_id)
);

-- ========== البحث بالمعنى ==========
create table chunks (
  id bigserial primary key,
  kind text not null check (kind in ('quran', 'hadith')),
  ref text not null,
  content text not null,
  embedding vector(1536),
  unique (kind, ref)
);

-- ========== المفاتيح والسجل ==========
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text unique not null,
  kind text not null check (kind in ('secret', 'public')),
  owner text not null,
  allowed_domains text[] not null default '{}',
  daily_limit int not null default 1000,
  active boolean not null default true,
  created_at timestamptz default now()
);

-- كل جواب له رقم ومحفوظ مع مصادره (للمراجعة لاحقاً)
create table requests (
  id uuid primary key,
  key_id uuid references api_keys(id),
  endpoint text not null,
  status text,
  latency_ms int,
  request jsonb,
  response jsonb,
  created_at timestamptz default now()
);

-- ========== الفهارس ==========
create index quran_norm_trgm on quran_ayat using gin (text_norm gin_trgm_ops);
create index hadith_norm_trgm on hadith using gin (text_norm gin_trgm_ops);
create index chunks_embedding on chunks using hnsw (embedding vector_cosine_ops);
create index requests_key_day on requests (key_id, created_at);

-- الجداول للخادم فقط (service role)؛ لا وصول مباشر من المتصفح
alter table sources enable row level security;
alter table quran_ayat enable row level security;
alter table quran_translations enable row level security;
alter table tafsir enable row level security;
alter table hadith enable row level security;
alter table hadith_translations enable row level security;
alter table chunks enable row level security;
alter table api_keys enable row level security;
alter table requests enable row level security;

-- ========== دوال البحث ==========

-- البحث بالمعنى
create or replace function match_chunks(q vector(1536), n int default 10)
returns table (kind text, ref text, score float)
language sql stable as $$
  select kind, ref, 1 - (embedding <=> q) as score
  from chunks where embedding is not null
  order by embedding <=> q limit n
$$;

-- البحث بالنص في الحديث (للتحقق من الرسائل)
create or replace function match_hadith_text(q text, n int default 5)
returns table (id text, score real)
language sql stable as $$
  select h.id, word_similarity(normalize_ar(q), h.text_norm) as score
  from hadith h
  where normalize_ar(q) <% h.text_norm
  order by score desc limit n
$$;

-- البحث بالنص في القرآن
create or replace function match_quran_text(q text, n int default 5)
returns table (surah int, ayah int, score real)
language sql stable as $$
  select a.surah, a.ayah, word_similarity(normalize_ar(q), a.text_norm) as score
  from quran_ayat a
  where normalize_ar(q) <% a.text_norm
  order by score desc limit n
$$;

-- جلب آيات بالمراجع ("2:255") مع التفسير وترجمة لغة معينة
create or replace function get_ayat(keys text[], lang text default 'ar')
returns table (surah int, ayah int, text text, text_simple text, tafsir text,
               translation text, translation_source text, source_id text)
language sql stable as $$
  select a.surah, a.ayah, a.text, a.text_simple,
         (select t.text from tafsir t where t.surah = a.surah and t.ayah = a.ayah limit 1),
         tr.text, tr.source_id, a.source_id
  from unnest(keys) k
  join quran_ayat a on a.surah = split_part(k, ':', 1)::int and a.ayah = split_part(k, ':', 2)::int
  left join lateral (
    select x.text, x.source_id from quran_translations x
    where x.surah = a.surah and x.ayah = a.ayah and x.lang = get_ayat.lang limit 1
  ) tr on true
$$;

-- جلب أحاديث بالمعرّف مع ترجمة لغة معينة
create or replace function get_hadiths(ids text[], lang text default 'ar')
returns table (id text, collection text, number text, text_ar text, grades jsonb,
               translation text, explanation text, source_id text)
language sql stable as $$
  select h.id, h.collection, h.number, h.text_ar, h.grades, tr.text, tr.explanation, h.source_id
  from hadith h
  left join lateral (
    select x.text, x.explanation from hadith_translations x
    where x.hadith_id = h.id and x.lang = get_hadiths.lang limit 1
  ) tr on true
  where h.id = any(ids)
$$;

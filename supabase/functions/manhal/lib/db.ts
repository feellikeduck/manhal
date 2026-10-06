// اتصال مباشر بـ Postgres. Supabase يعطي كل Edge Function المتغير SUPABASE_DB_URL تلقائياً.
import postgres from "npm:postgres@3";

type Sql = ReturnType<typeof postgres>;
let client: Sql | null = null;

export function sql(): Sql {
  if (!client) {
    const url = Deno.env.get("SUPABASE_DB_URL") ?? Deno.env.get("DATABASE_URL");
    if (!url) throw new Error("SUPABASE_DB_URL / DATABASE_URL is not set");
    client = postgres(url, { max: 3, prepare: false, onnotice: () => {} });
  }
  return client;
}

export interface AyahRow {
  surah: number;
  ayah: number;
  text: string;
  text_simple: string;
  tafsir: string | null;
  translation: string | null;
  translation_source: string | null;
  source_id: string | null;
}

export interface HadithRow {
  id: string;
  collection: string;
  number: string;
  text_ar: string;
  grades: { grader: string; grade: string }[];
  attribution: string | null;
  translation: string | null;
  explanation: string | null;
  source_id: string | null;
}

export async function matchChunks(q: number[], n: number) {
  const rows = await sql()`select kind, ref, score from match_chunks(${`[${q.join(",")}]`}::vector, ${n})`;
  return rows.map((r) => ({ kind: r.kind as "quran" | "hadith", ref: r.ref as string, score: Number(r.score) }));
}

export async function matchHadithText(q: string, n = 5) {
  const rows = await sql()`select id, score from match_hadith_text(${q}, ${n})`;
  return rows.map((r) => ({ id: r.id as string, score: Number(r.score) }));
}

export async function matchQuranText(q: string, n = 5) {
  const rows = await sql()`select surah, ayah, score from match_quran_text(${q}, ${n})`;
  return rows.map((r) => ({ surah: Number(r.surah), ayah: Number(r.ayah), score: Number(r.score) }));
}

export async function getAyat(keys: string[], lang: string): Promise<AyahRow[]> {
  if (!keys.length) return [];
  const s = sql();
  return (await s`select * from get_ayat(${s.array(keys)}::text[], ${lang})`) as unknown as AyahRow[];
}

export async function getHadiths(ids: string[], lang: string): Promise<HadithRow[]> {
  if (!ids.length) return [];
  const s = sql();
  return (await s`select * from get_hadiths(${s.array(ids)}::text[], ${lang})`) as unknown as HadithRow[];
}

export interface KeyRow {
  id: string;
  kind: "secret" | "public";
  owner: string;
  allowed_domains: string[];
  daily_limit: number;
  active: boolean;
}

export async function findKey(hash: string): Promise<KeyRow | null> {
  const [row] = await sql()`
    select id, kind, owner, allowed_domains, daily_limit, active from api_keys where key_hash = ${hash}`;
  return (row as unknown as KeyRow | undefined) ?? null;
}

export async function countToday(keyId: string): Promise<number> {
  const [r] = await sql()`
    select count(*)::int as n from requests
    where key_id = ${keyId} and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
  return Number(r.n);
}

export async function logRequest(row: {
  id: string;
  key_id: string | null;
  endpoint: string;
  status?: string;
  latency_ms: number;
  request: unknown;
  response: unknown;
}) {
  try {
    const s = sql();
    await s`insert into requests (id, key_id, endpoint, status, latency_ms, request, response)
      values (${row.id}, ${row.key_id}, ${row.endpoint}, ${row.status ?? null}, ${row.latency_ms},
              ${s.json((row.request ?? null) as never)}, ${s.json((row.response ?? null) as never)})`;
  } catch (e) {
    console.error("log failed:", e);
  }
}

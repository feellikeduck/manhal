// اتصال مباشر بقاعدة البيانات للسكربتات (أسرع من الـ API في الإدخال الكبير)
// DATABASE_URL: من Supabase > Connect > Session pooler
import postgres from "npm:postgres@3";

const url = Deno.env.get("DATABASE_URL");
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
export const sql = postgres(url, { max: 4, onnotice: () => {}, prepare: false });

export async function upsertSource(s: { id: string; name: string; url: string; license: string; version?: string | null }) {
  await sql`
    insert into sources ${sql({ ...s, version: s.version ?? null })}
    on conflict (id) do update set name = excluded.name, url = excluded.url, license = excluded.license,
      version = excluded.version, fetched_at = now()`;
}

export async function getJSON<T = any>(url: string, tries = 3): Promise<T> {
  for (let i = 1;; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json() as T;
    } catch (e) {
      if (i >= tries) throw new Error(`GET ${url} failed: ${e}`);
      await new Promise((ok) => setTimeout(ok, 1000 * i));
    }
  }
}

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export { flag, opt } from "./_args.ts";

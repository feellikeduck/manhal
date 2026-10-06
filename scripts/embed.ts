// يبني مقاطع البحث بالمعنى (embeddings) للآيات والأحاديث. يكمل من حيث توقف.
// deno task embed                 (الكل)
// deno task embed --only quran     أو --only hadith
// deno task embed --limit 500      (للتجربة)
import { chunk, flag, opt, sql } from "./_db.ts";
import { COLLECTIONS, SURAH_AR } from "../supabase/functions/manhal/lib/config.ts";
import { clip } from "../supabase/functions/manhal/lib/text.ts";

const MODEL = Deno.env.get("MANHAL_MODEL_EMBED") ?? "text-embedding-3-small";
const KEY = Deno.env.get("OPENAI_API_KEY");
const FAKE = flag("fake"); // للاختبار المحلي بدون OpenAI
const ONLY = opt("only");
const LIMIT = Number(opt("limit", "1000000"));
if (!KEY && !FAKE) throw new Error("OPENAI_API_KEY is not set");

async function embed(texts: string[]): Promise<number[][]> {
  if (FAKE) return texts.map((t) => Array.from({ length: 1536 }, (_, i) => Math.sin(t.length * (i + 1))));
  for (let attempt = 1;; attempt++) {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: texts }),
    });
    if (r.ok) return (await r.json()).data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
    if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`embeddings ${r.status}: ${await r.text()}`);
    await new Promise((ok) => setTimeout(ok, 2000 * attempt));
  }
}

type Row = { kind: "quran" | "hadith"; ref: string; content: string };

async function pendingQuran(): Promise<Row[]> {
  const rows = await sql`
    select a.surah, a.ayah, a.text_simple, t.text as tafsir, tr.text as en
    from quran_ayat a
    left join tafsir t on t.surah = a.surah and t.ayah = a.ayah
    left join lateral (select text from quran_translations x where x.surah = a.surah and x.ayah = a.ayah and x.lang = 'en' limit 1) tr on true
    where not exists (select 1 from chunks c where c.kind = 'quran' and c.ref = a.surah || ':' || a.ayah)
    order by a.surah, a.ayah limit ${LIMIT}`;
  return rows.map((r: any) => ({
    kind: "quran",
    ref: `${r.surah}:${r.ayah}`,
    content: [`${SURAH_AR[r.surah]} ${r.surah}:${r.ayah}`, r.text_simple, r.tafsir && `التفسير الميسر: ${r.tafsir}`, r.en]
      .filter(Boolean).join("\n"),
  }));
}

async function pendingHadith(): Promise<Row[]> {
  const rows = await sql`
    select h.id, h.collection, h.number, h.text_ar, tr.text as en
    from hadith h
    left join lateral (select text from hadith_translations x where x.hadith_id = h.id and x.lang = 'en' limit 1) tr on true
    where not exists (select 1 from chunks c where c.kind = 'hadith' and c.ref = h.id)
    order by h.id limit ${LIMIT}`;
  return rows.map((r: any) => ({
    kind: "hadith",
    ref: r.id,
    content: clip(
      [`${COLLECTIONS[r.collection]?.ar ?? r.collection} ${r.number}`, r.text_ar, r.en].filter(Boolean).join("\n"),
      6000,
    ),
  }));
}

const todo = [
  ...(ONLY !== "hadith" ? await pendingQuran() : []),
  ...(ONLY !== "quran" ? await pendingHadith() : []),
];
console.log(`embedding ${todo.length} chunks with ${FAKE ? "FAKE vectors" : MODEL}…`);
let done = 0;
for (const batch of chunk(chunk(todo, 100), 3)) {
  await Promise.all(batch.map(async (part) => {
    const vecs = await embed(part.map((r) => r.content));
    const rows = part.map((r, i) => ({ ...r, embedding: `[${vecs[i].join(",")}]` }));
    await sql`insert into chunks ${
      sql(rows)
    } on conflict (kind, ref) do update set content = excluded.content, embedding = excluded.embedding`;
    done += part.length;
  }));
  console.log(`  ${done}/${todo.length}`);
}
console.log("✓ embeddings done");
await sql.end();

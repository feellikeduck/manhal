// يسحب موسوعة الأحاديث النبوية (HadeethEnc) — من منصات جمعية خدمة المحتوى الإسلامي باللغات
// أحاديث مختارة مع الحكم والتخريج والشرح والترجمة المعتمدة. الشروط: بلا تعديل، مع ذكر الناشر والمصدر.
// deno task import:hadeethenc                 (العربي + الإنجليزي)
// deno task import:hadeethenc --langs en,ur,id --limit 200
import { chunk, getJSON, opt, sql, upsertSource } from "./_db.ts";

const API = "https://hadeethenc.com/api/v1";
const LANGS = (opt("langs") ?? "en").split(",").map((l) => l.trim()).filter((l) => l && l !== "ar");
const LIMIT = Number(opt("limit", "1000000"));
const CONCURRENCY = 6;

await upsertSource({
  id: "hadeethenc",
  name: "موسوعة الأحاديث النبوية (HadeethEnc) — جمعية خدمة المحتوى الإسلامي باللغات",
  url: "https://hadeethenc.com",
  license: "HadeethEnc: بلا تعديل أو إضافة أو حذف، مع ذكر الناشر والمصدر (HadeethEnc.com)",
});

const asArray = (j: any): any[] => (Array.isArray(j) ? j : j?.data ?? j?.result ?? []);

// 1) كل التصنيفات ← كل معرّفات الأحاديث
const categories = asArray(await getJSON(`${API}/categories/list/?language=ar`));
console.log(`HadeethEnc: ${categories.length} تصنيف`);
const ids = new Set<string>();
for (const c of categories) {
  for (let page = 1;; page++) {
    const j = await getJSON<any>(`${API}/hadeeths/list/?language=ar&category_id=${c.id}&page=${page}&per_page=100`);
    for (const h of asArray(j)) ids.add(String(h.id));
    const last = Number(j?.meta?.last_page ?? 1);
    if (page >= last || ids.size >= LIMIT) break;
  }
  if (ids.size >= LIMIT) break;
}
const all = [...ids].slice(0, LIMIT);
console.log(`HadeethEnc: ${all.length} حديث`);

async function one(id: string, language: string) {
  try {
    return await getJSON<any>(`${API}/hadeeths/one/?id=${id}&language=${language}`);
  } catch {
    return null;
  }
}

// 2) التفاصيل بالعربي ثم الترجمات
let done = 0;
for (const part of chunk(all, CONCURRENCY * 10)) {
  const rows: any[] = [];
  const trs: any[] = [];
  for (const group of chunk(part, CONCURRENCY)) {
    await Promise.all(group.map(async (id) => {
      const ar = await one(id, "ar");
      const text = (ar?.hadeeth ?? ar?.text ?? "").trim();
      if (!text) return;
      const grade = (ar?.grade ?? "").trim();
      rows.push({
        id: `hadeethenc:${id}`,
        collection: "hadeethenc",
        number: id,
        text_ar: text,
        attribution: (ar?.attribution ?? "").trim() || null,
        grades: sql.json(grade ? [{ grader: "موسوعة الأحاديث النبوية", grade }] : []),
        source_id: "hadeethenc",
      });
      if (ar?.explanation) {
        trs.push({
          hadith_id: `hadeethenc:${id}`,
          lang: "ar",
          text,
          explanation: ar.explanation.trim(),
          source_id: "hadeethenc",
        });
      }
      for (const lang of LANGS) {
        const t = await one(id, lang);
        const tt = (t?.hadeeth ?? t?.text ?? "").trim();
        if (tt) {
          trs.push({
            hadith_id: `hadeethenc:${id}`,
            lang,
            text: tt,
            explanation: (t?.explanation ?? "").trim() || null,
            source_id: "hadeethenc",
          });
        }
      }
    }));
  }
  if (rows.length) {
    await sql`insert into hadith ${sql(rows)}
      on conflict (id) do update set text_ar = excluded.text_ar, attribution = excluded.attribution, grades = excluded.grades`;
  }
  const valid = new Set(rows.map((r) => r.id));
  const okTrs = trs.filter((t) => valid.has(t.hadith_id));
  if (okTrs.length) {
    await sql`insert into hadith_translations ${sql(okTrs)}
      on conflict (hadith_id, lang, source_id) do update set text = excluded.text, explanation = excluded.explanation`;
  }
  done += part.length;
  console.log(`  ${done}/${all.length}`);
}
if (!done) console.warn("لم يُسحب أي حديث — تحقق من شكل رد الـ API");
console.log("✓ HadeethEnc done");
await sql.end();

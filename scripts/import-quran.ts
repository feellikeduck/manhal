// القرآن الكريم من المراجع المعتمدة في الحزمة العلمية فقط:
// - نص المصحف (العثماني + الإملائي): مجمع الملك فهد لطباعة المصحف الشريف — منصة المطورين
//   نزّل ملف بيانات مصحف حفص (JSON) من: https://qurancomplex.gov.sa/quran-dev
// - ترجمات المعاني والتفسير العربي: موسوعة القرآن الكريم QuranEnc (جمعية خدمة المحتوى الإسلامي باللغات)
//
// deno task import:quran --kfc data/hafs.json
// deno task import:quran --kfc data/hafs.json --keys english_saheeh,urdu_junagarhi --tafsir arabic_moyassar
import { chunk, flag, getJSON, opt, sql, upsertSource } from "./_db.ts";
import { normalizeAr } from "../supabase/functions/manhal/lib/text.ts";

const QURANENC = "https://quranenc.com/api/v1";
const KFC_FILE = opt("kfc");
const KEYS = (opt("keys") ?? Deno.env.get("QURANENC_KEYS") ?? "english_saheeh").split(",").map((k) => k.trim()).filter(Boolean);
const TAFSIR = opt("tafsir") ?? Deno.env.get("QURANENC_TAFSIR_KEY") ?? "auto";

// ── 1) نص المصحف من ملف مجمع الملك فهد ──
if (!KFC_FILE) {
  console.error("حدد ملف مصحف المجمع: --kfc <path>  (من qurancomplex.gov.sa/quran-dev)");
  Deno.exit(1);
}
const raw = JSON.parse(await Deno.readTextFile(KFC_FILE));
const list: any[] = Array.isArray(raw) ? raw : raw.data ?? raw.ayat ?? raw.quran ?? Object.values(raw).find(Array.isArray) ?? [];
const pick = (o: any, keys: string[]) => keys.map((k) => o?.[k]).find((v) => v !== undefined && v !== null && v !== "");
let derived = 0;
const ayat = list.map((o) => {
  // نسخة المجمع v30 (يونيكود): aya_text_unicode، وفي آخرها علامة نهاية الآية ورقمها «۝١» فنشيلها
  const text = String(pick(o, ["aya_text_unicode", "aya_text", "text", "verse_text", "uthmani"]) ?? "")
    .replace(/\s*\u06DD[\u0660-\u0669\u06F0-\u06F90-9]*\s*$/, "")
    .trim();
  const simple = String(pick(o, ["aya_text_emlaey", "aya_text_imlaei", "text_simple", "imlaei"]) ?? "").trim();
  return {
    surah: Number(pick(o, ["sura_no", "sura", "surah", "chapter"])),
    ayah: Number(pick(o, ["aya_no", "aya", "ayah", "verse"])),
    text,
    text_simple: simple || (derived++, normalizeAr(text)),
    source_id: "quran_kfc",
  };
}).filter((a) => a.surah && a.ayah && a.text);
if (ayat.length !== 6236) throw new Error(`عدد الآيات ${ayat.length} (المتوقع 6236) — تأكد من ملف المجمع وأسماء حقوله`);

await upsertSource({
  id: "quran_kfc",
  name: "المصحف الشريف — رواية حفص، مجمع الملك فهد لطباعة المصحف الشريف",
  url: "https://qurancomplex.gov.sa/quran-dev",
  license: "نص المصحف من منصة المطورين في المجمع؛ يُعرض حرفياً بلا تعديل",
  version: opt("kfc-version") ?? null,
});
for (const part of chunk(ayat, 1000)) {
  await sql`insert into quran_ayat ${sql(part)}
    on conflict (surah, ayah) do update set text = excluded.text, text_simple = excluded.text_simple, source_id = excluded.source_id`;
}
console.log(
  `✓ ${ayat.length} آية من مصحف المجمع${
    derived ? ` (${derived} آية بلا نص إملائي — اشتُق بالتوحيد)` : " (مع النص الإملائي من المجمع)"
  }`,
);
if (flag("skip-quranenc")) {
  await sql.end();
  Deno.exit(0);
}

// ── 2) QuranEnc: الترجمات والتفسير ──
const LANG_GUESS: Record<string, string> = {
  english: "en",
  urdu: "ur",
  indonesian: "id",
  french: "fr",
  turkish: "tr",
  bengali: "bn",
  spanish: "es",
  german: "de",
  russian: "ru",
  chinese: "zh",
  malay: "ms",
  persian: "fa",
  hindi: "hi",
  tagalog: "tl",
  arabic: "ar",
};
async function catalog(lang: string): Promise<any[]> {
  try {
    const j = await getJSON<any>(`${QURANENC}/translations/list/${lang}`);
    return j.translations ?? j.result ?? (Array.isArray(j) ? j : []);
  } catch (e) {
    console.warn(`QuranEnc list (${lang}) unavailable: ${e}`);
    return [];
  }
}
async function fetchKey(key: string) {
  const rows: { surah: number; ayah: number; text: string }[] = [];
  for (let s = 1; s <= 114; s++) {
    const j = await getJSON<any>(`${QURANENC}/translation/sura/${key}/${s}`);
    const items: any[] = j.result ?? j;
    if (!Array.isArray(items) || !items.length) throw new Error(`QuranEnc ${key} sura ${s}: unexpected response shape`);
    for (const it of items) {
      rows.push({ surah: Number(it.sura), ayah: Number(it.aya), text: String(it.translation ?? "").trim() });
    }
    if (s % 38 === 0) console.log(`  ${key}: ${s}/114`);
  }
  return rows;
}

// التفسير العربي من QuranEnc (مثل التفسير الميسر أو المختصر)
const arabic = await catalog("ar");
const tafsirKey = TAFSIR === "auto"
  ? arabic.map((t) => t.key).find((k: string) => /moyassar|muyassar|mokhtasar|mukhtasar/i.test(k))
  : TAFSIR === "none"
  ? undefined
  : TAFSIR;
if (arabic.length) console.log(`QuranEnc (ar): ${arabic.map((t) => t.key).join(", ")}`);
if (tafsirKey) {
  const meta = arabic.find((t) => t.key === tafsirKey) ?? {};
  await upsertSource({
    id: `quranenc_${tafsirKey}`,
    name: `QuranEnc — ${meta.title ?? tafsirKey}`,
    url: `https://quranenc.com/ar/browse/${tafsirKey}`,
    license: "QuranEnc: بلا تعديل أو إضافة أو حذف، مع ذكر الناشر والمصدر ورقم الإصدار",
    version: meta.version ? String(meta.version) : null,
  });
  const rows = (await fetchKey(tafsirKey)).map((r) => ({ ...r, source_id: `quranenc_${tafsirKey}` }));
  for (const part of chunk(rows, 1000)) {
    await sql`insert into tafsir ${sql(part)} on conflict (surah, ayah, source_id) do update set text = excluded.text`;
  }
  console.log(`✓ التفسير: ${tafsirKey} (${rows.length} آية)`);
} else {
  console.warn("لم يُحدد تفسير عربي من QuranEnc — مرّر --tafsir <key> من القائمة أعلاه");
}

for (const key of KEYS) {
  const prefix = key.split("_")[0];
  const meta = (await catalog(LANG_GUESS[prefix] ?? prefix)).find((t) => t.key === key) ?? {};
  const lang = meta.language_iso_code ?? LANG_GUESS[prefix] ?? prefix;
  const sid = `quranenc_${key}`;
  await upsertSource({
    id: sid,
    name: `QuranEnc — ${meta.title ?? key}`,
    url: `https://quranenc.com/en/browse/${key}`,
    license: "QuranEnc: بلا تعديل أو إضافة أو حذف، مع ذكر الناشر والمصدر (QuranEnc.com) ورقم الإصدار",
    version: meta.version ? String(meta.version) : null,
  });
  const rows = (await fetchKey(key)).map((r) => ({ ...r, lang, source_id: sid }));
  for (const part of chunk(rows, 1000)) {
    await sql`insert into quran_translations ${sql(part)}
      on conflict (surah, ayah, lang, source_id) do update set text = excluded.text`;
  }
  console.log(`✓ ${key} (${lang}): ${rows.length} آية${meta.version ? ` — الإصدار ${meta.version}` : ""}`);
}
await sql.end();

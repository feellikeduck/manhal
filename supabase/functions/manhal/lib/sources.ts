import { COLLECTIONS, config, GRADE_LABEL, SURAH_AR } from "./config.ts";
import { type AyahRow, getAyat, getHadiths, type HadithRow, matchChunks } from "./db.ts";
import { embed } from "./openai.ts";
import { primaryGrade } from "./text.ts";
import type { Source } from "./types.ts";

export function quranTitle(surah: number, ayah: number | string, lang: string) {
  return lang === "ar" ? `${SURAH_AR[surah]}: ${ayah}` : `Quran ${surah}:${ayah}`;
}

export function hadithTitle(collection: string, number: string, lang: string) {
  const c = COLLECTIONS[collection] ?? { ar: collection, en: collection };
  return lang === "ar" ? `${c.ar}، ${number}` : `${c.en} ${number}`;
}

export function gradeText(s: Source, lang: string): string {
  const { grade } = primaryGrade(s.grades);
  const cls = s.grade_class ?? "unknown";
  const l = lang === "ar" ? GRADE_LABEL[cls].ar : GRADE_LABEL[cls].en;
  return grade ? `${l} — ${grade.grader}: ${grade.grade}` : l;
}

export function ayahToSource(r: AyahRow, lang: string): Source {
  return {
    sid: "",
    type: "quran",
    ref: `${r.surah}:${r.ayah}`,
    title: quranTitle(r.surah, r.ayah, lang),
    text: r.text,
    translation: r.translation ?? undefined,
    tafsir: r.tafsir ?? undefined,
    source_id: r.source_id ?? undefined,
  };
}

export function hadithToSource(r: HadithRow, lang: string): Source {
  const { cls } = primaryGrade(r.grades);
  return {
    sid: "",
    type: "hadith",
    ref: r.id,
    title: r.attribution
      ? `${r.attribution} — ${hadithTitle(r.collection, r.number, lang)}`
      : hadithTitle(r.collection, r.number, lang),
    text: r.text_ar,
    translation: r.translation ?? undefined,
    tafsir: r.explanation ?? undefined,
    grades: r.grades,
    grade_class: cls,
    source_id: r.source_id ?? undefined,
  };
}

/** يجيب المصادر بمراجعها ويحافظ على الترتيب */
export async function loadSources(refs: { kind: "quran" | "hadith"; ref: string; score?: number }[], lang: string) {
  const quranKeys = refs.filter((r) => r.kind === "quran").map((r) => r.ref);
  const hadithIds = refs.filter((r) => r.kind === "hadith").map((r) => r.ref);
  const [ayat, hadiths] = await Promise.all([getAyat(quranKeys, lang), getHadiths(hadithIds, lang)]);
  const byRef = new Map<string, Source>();
  for (const a of ayat) byRef.set(`quran|${a.surah}:${a.ayah}`, ayahToSource(a, lang));
  for (const h of hadiths) byRef.set(`hadith|${h.id}`, hadithToSource(h, lang));
  const out: Source[] = [];
  for (const r of refs) {
    const s = byRef.get(`${r.kind}|${r.ref}`);
    if (s && !out.some((o) => o.type === s.type && o.ref === s.ref)) out.push({ ...s, score: r.score });
  }
  return out;
}

export function numberSources(sources: Source[]): Source[] {
  return sources.map((s, i) => ({ ...s, sid: `S${i + 1}` }));
}

/** البحث بالمعنى */
export async function retrieve(query: string, lang: string, k = config.retrieveK): Promise<Source[]> {
  const [vec] = await embed([query]);
  const hits = await matchChunks(vec, k);
  return numberSources(await loadSources(hits, lang));
}

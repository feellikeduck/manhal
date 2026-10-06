import { gradeText, loadSources } from "./sources.ts";
import { SURAH_AR } from "./config.ts";
import type { Check, Source } from "./types.ts";

/**
 * المودل لا يكتب نص آية أو حديث أبداً. يكتب رمزاً:
 *   {{quran:2:255}}  {{quran:2:255-257}}  {{hadith:bukhari:1}}
 * وهذا الملف يستبدل الرمز بالنص الحقيقي من قاعدة البيانات.
 */
const RE = /\{\{\s*(quran|hadith)\s*:\s*([^}\s]+)\s*\}\}/g;
const MAX_RANGE = 20;

export interface Placeholder {
  raw: string;
  kind: "quran" | "hadith";
  keys: string[];
  valid: boolean;
}

export function parsePlaceholders(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const m of text.matchAll(RE)) {
    const kind = m[1] as "quran" | "hadith";
    const arg = m[2];
    if (kind === "hadith") {
      out.push({ raw: m[0], kind, keys: [arg], valid: /^[a-z]+:[\w.-]+$/.test(arg) });
      continue;
    }
    const q = arg.match(/^(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?$/);
    if (!q) {
      out.push({ raw: m[0], kind, keys: [], valid: false });
      continue;
    }
    const s = +q[1], a1 = +q[2], a2 = q[3] ? +q[3] : a1;
    const valid = s >= 1 && s <= 114 && a1 >= 1 && a2 >= a1 && a2 - a1 < MAX_RANGE;
    const keys = valid ? Array.from({ length: a2 - a1 + 1 }, (_, i) => `${s}:${a1 + i}`) : [];
    out.push({ raw: m[0], kind, keys, valid });
  }
  return out;
}

function renderQuran(ayat: Source[], lang: string): { text: string; missingTranslation: boolean } {
  const [s] = ayat[0].ref.split(":").map(Number);
  const nums = ayat.map((x) => x.ref.split(":")[1]);
  const span = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : nums[0];
  if (lang === "ar") {
    return { text: `﴿${ayat.map((x) => x.text).join(" ")}﴾ [${SURAH_AR[s]}: ${span}]`, missingTranslation: false };
  }
  if (ayat.every((x) => x.translation)) {
    return { text: `"${ayat.map((x) => x.translation).join(" ")}" [Quran ${s}:${span}]`, missingTranslation: false };
  }
  return { text: `﴿${ayat.map((x) => x.text).join(" ")}﴾ [Quran ${s}:${span}]`, missingTranslation: true };
}

function renderHadith(h: Source, lang: string): { text: string; missingTranslation: boolean } {
  const g = gradeText(h, lang);
  if (lang === "ar") return { text: `«${h.text}» [${h.title} — ${g}]`, missingTranslation: false };
  if (h.translation) return { text: `"${h.translation}" [${h.title} — ${g}]`, missingTranslation: false };
  return { text: `«${h.text}» [${h.title} — ${g}]`, missingTranslation: true };
}

export async function resolvePlaceholders(text: string, lang: string, context: Source[]) {
  const phs = parsePlaceholders(text);
  const checks: Check[] = [];
  if (!phs.length) return { text, used: [] as Source[], checks };

  const key = (kind: string, ref: string) => `${kind}|${ref}`;
  const known = new Map(context.map((s) => [key(s.type, s.ref), s]));
  const wanted = phs.flatMap((p) => p.keys.map((ref) => ({ kind: p.kind, ref })));
  const missing = wanted.filter((w) => !known.has(key(w.kind, w.ref)));
  let next = context.length;
  for (const s of await loadSources(missing, lang)) {
    known.set(key(s.type, s.ref), { ...s, sid: `S${++next}` });
  }

  const used = new Map<string, Source>();
  const unresolved: string[] = [];
  const outOfContext: string[] = [];
  const noTranslation: string[] = [];
  const inContext = new Set(context.map((s) => key(s.type, s.ref)));

  for (const p of phs) {
    const items = p.keys.map((r) => known.get(key(p.kind, r)));
    if (!p.valid || !items.length || items.some((x) => !x)) {
      unresolved.push(p.raw);
      text = text.replace(p.raw, () => (lang === "ar" ? "[مرجع غير موجود]" : "[reference not found]"));
      continue;
    }
    const srcs = items as Source[];
    srcs.forEach((s) => {
      used.set(key(s.type, s.ref), s);
      if (!inContext.has(key(s.type, s.ref))) outOfContext.push(s.ref);
    });
    const r = p.kind === "quran" ? renderQuran(srcs, lang) : renderHadith(srcs[0], lang);
    if (r.missingTranslation) noTranslation.push(p.raw);
    text = text.replace(p.raw, () => r.text);
  }

  checks.push(
    unresolved.length
      ? { name: "placeholders", ok: false, severity: "error", detail: `unresolved: ${unresolved.join(", ")}` }
      : { name: "placeholders", ok: true, severity: "error" },
  );
  if (outOfContext.length) {
    checks.push({
      name: "placeholders_context",
      ok: false,
      severity: "warning",
      detail: `quoted outside retrieved sources: ${outOfContext.join(", ")}`,
    });
  }
  if (noTranslation.length) {
    checks.push({
      name: "approved_translation",
      ok: false,
      severity: "warning",
      detail: `no approved translation for ${lang}: ${noTranslation.join(", ")}`,
    });
  }
  return { text, used: [...used.values()], checks };
}

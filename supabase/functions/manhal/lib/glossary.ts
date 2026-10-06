import { GLOSSARY } from "./glossary-data.ts";
import { normalizeAr } from "./text.ts";
import type { Check } from "./types.ts";

export type Term = (typeof GLOSSARY.terms)[number];

export const GLOSSARY_LANGS: readonly string[] = GLOSSARY.languages;

const PREFIXES = ["", "و", "ف", "ب", "ل", "ك", "وال", "فال", "بال", "كال", "لل"];

function formsOf(v: string): string[] {
  const forms = new Set(PREFIXES.map((p) => p + v));
  if (v.startsWith("ال")) { for (const p of PREFIXES) forms.add(p + v.slice(2)); }
  return [...forms];
}

const INDEX = GLOSSARY.terms.map((t) => {
  const variants = [t.ar, ...t.ar_variants].map(normalizeAr).filter((v) => v.length > 1);
  return {
    term: t,
    phrases: variants.filter((v) => v.includes(" ")),
    forms: variants.filter((v) => !v.includes(" ")).flatMap(formsOf),
  };
});

/** المصطلحات الموجودة في نص عربي */
export function findTerms(textAr: string): Term[] {
  const norm = normalizeAr(textAr);
  const padded = ` ${norm} `;
  const tokens = new Set(norm.split(" "));
  return INDEX
    .filter(({ phrases, forms }) => phrases.some((v) => padded.includes(` ${v} `)) || forms.some((f) => tokens.has(f)))
    .map(({ term }) => term);
}

/** إدخالات المسرد التي تُعطى للمودل */
export function glossaryFor(terms: Term[], lang: string) {
  if (!GLOSSARY_LANGS.includes(lang)) return [];
  return terms.map((t) => ({
    ar: t.ar,
    use: t.en.term,
    first_mention: t.en.first_mention,
    never_use: t.en.forbidden,
    note: t.note || undefined,
  }));
}

function containsPhrase(text: string, phrase: string): boolean {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${esc}([^A-Za-z]|$)`, "i").test(text);
}

/**
 * فحص المصطلحات في ناتج غير عربي:
 * - forbidden: خطأ دائماً (مثل holy war) ← error
 * - caution: قد تكون خطأ إذا كان المصطلح العربي في السياق ← warning
 */
export function checkGlossary(output: string, lang: string, contextTerms: Term[] = []): Check[] {
  if (lang === "ar") return [];
  if (!GLOSSARY_LANGS.includes(lang)) {
    return [{ name: "glossary", ok: false, severity: "warning", detail: `glossary not available for '${lang}'` }];
  }
  const checks: Check[] = [];
  for (const t of GLOSSARY.terms) {
    for (const f of t.en.forbidden) {
      if (containsPhrase(output, f)) {
        checks.push({
          name: "glossary_forbidden",
          ok: false,
          severity: "error",
          detail: `"${f}" → use "${t.en.term}" (${t.ar})`,
        });
      }
    }
  }
  for (const t of contextTerms) {
    for (const c of t.en.caution) {
      if (containsPhrase(output, c) && !containsPhrase(output, t.en.term)) {
        checks.push({
          name: "glossary_caution",
          ok: false,
          severity: "warning",
          detail: `"${c}" for ${t.ar} — preferred "${t.en.term}"`,
        });
      }
    }
  }
  if (!checks.length) checks.push({ name: "glossary", ok: true, severity: "error" });
  return checks;
}

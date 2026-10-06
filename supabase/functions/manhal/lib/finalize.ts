import { checkCitations, checkFreeQuotes, decideStatus } from "./checks.ts";
import { config, disclosure, label } from "./config.ts";
import { checkGlossary, type Term } from "./glossary.ts";
import { resolvePlaceholders } from "./resolve.ts";
import { gradeText } from "./sources.ts";
import { clip } from "./text.ts";
import type { Level, ManhalResult, Source } from "./types.ts";

/** المصادر كما تُعطى للمودل */
export function sourcePayload(sources: Source[], lang: string) {
  return sources.map((s) => ({
    sid: s.sid,
    type: s.type,
    ref: s.ref,
    title: s.title,
    text: clip(s.text, 1200),
    translation: s.translation ? clip(s.translation, 800) : undefined,
    explanation: s.tafsir ? clip(s.tafsir, 600) : undefined,
    grade: s.type === "hadith" ? gradeText(s, lang) : undefined,
  }));
}

type Finalized = Omit<ManhalResult, "id" | "capability">;

/**
 * الخطوة الأخيرة لكل جواب:
 * 1) تحقق من أي نص اقتبسه المودل بنفسه  2) استبدال الرموز بالنص الحقيقي
 * 3) تحقق من الإسناد [S#]  4) المسرد  5) الحالة
 */
export async function finalize(opts: {
  raw: string;
  sources: Source[];
  lang: string;
  level?: Level;
  abstain?: boolean;
  contextTerms?: Term[];
  requireCitations?: boolean;
}): Promise<Finalized> {
  const { raw, sources, lang, level } = opts;
  const quoteChecks = await checkFreeQuotes(raw, sources);
  const resolved = await resolvePlaceholders(raw, lang, sources);
  const { checks: citeChecks, cited } = checkCitations(resolved.text, sources);
  const glossaryChecks = checkGlossary(resolved.text, lang, opts.contextTerms ?? []);
  const checks = [...quoteChecks, ...resolved.checks, ...citeChecks, ...glossaryChecks];

  const usedRefs = new Set(resolved.used.map((s) => `${s.type}|${s.ref}`));
  const final = [
    ...sources.filter((s) => cited.includes(s.sid) || usedRefs.has(`${s.type}|${s.ref}`)),
    ...resolved.used.filter((u) => !sources.some((s) => s.type === u.type && s.ref === u.ref)),
  ];

  const citedCount = opts.requireCitations === false ? Math.max(final.length, 1) : cited.length + resolved.used.length;
  const status = decideStatus({ level, abstain: opts.abstain, checks, citedCount });
  const result: Finalized = {
    answer: resolved.text,
    status,
    status_label: label(status, lang),
    level,
    lang,
    sources: final,
    checks,
    disclosure: disclosure(lang),
  };
  if (status === "referral") {
    const personal = level === "D";
    result.referral = {
      text: lang === "ar"
        ? (personal ? config.referral.ar : config.referral.generalAr)
        : (personal ? config.referral.en : config.referral.generalEn),
      url: config.referral.url,
    };
  }
  return result;
}

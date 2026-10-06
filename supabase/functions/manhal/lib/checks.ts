import { config } from "./config.ts";
import { matchHadithText, matchQuranText } from "./db.ts";
import { compareWords, containsText, wordCount } from "./text.ts";
import type { Check, Level, Source, Status } from "./types.ts";

/** كل [S#] في الجواب لازم يكون من المصادر المسترجعة */
export function checkCitations(answer: string, sources: Source[]): { checks: Check[]; cited: string[] } {
  const cited = [...new Set([...answer.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]))];
  const valid = new Set(sources.map((s) => s.sid));
  const bad = cited.filter((c) => !valid.has(c));
  const checks: Check[] = [
    bad.length
      ? { name: "citations", ok: false, severity: "error", detail: `unknown sources cited: ${bad.join(", ")}` }
      : { name: "citations", ok: true, severity: "error" },
  ];
  return { checks, cited: cited.filter((c) => valid.has(c)) };
}

/** يستخرج النصوص المقتبسة التي كتبها المودل بنفسه (بدل الرموز) */
export function extractQuotes(text: string): string[] {
  const out: string[] = [];
  for (const re of [/﴿([^﴾]+)﴾/g, /«([^»]+)»/g, /“([^”]+)”/g, /"([^"]+)"/g]) {
    for (const m of text.matchAll(re)) {
      if (/[\u0600-\u06FF]/.test(m[1]) && wordCount(m[1]) >= 4) out.push(m[1]);
    }
  }
  return out;
}

/**
 * إذا كتب المودل آية أو حديثاً بنفسه، نتحقق أن النص موجود فعلاً.
 * يُشغَّل على ناتج المودل الخام قبل استبدال الرموز.
 */
export async function checkFreeQuotes(rawModelText: string, sources: { text: string }[] = []): Promise<Check[]> {
  const quotes = extractQuotes(rawModelText);
  if (!quotes.length) return [{ name: "free_quotes", ok: true, severity: "error" }];
  const bad: string[] = [];
  for (const q of quotes.slice(0, 6)) {
    // اقتباس حرفي من مصدر أُعطي للمودل (مثل تعريف قاموس الحزمة) مقبول
    if (sources.some((s) => containsText(s.text, q))) continue;
    const [qm, hm] = await Promise.all([matchQuranText(q, 1), matchHadithText(q, 1)]);
    const best = Math.max(qm[0]?.score ?? 0, hm[0]?.score ?? 0);
    if (best < config.threshold.quote) bad.push(q.slice(0, 60));
  }
  return [
    bad.length
      ? { name: "free_quotes", ok: false, severity: "error", detail: `unverified quoted text: ${bad.join(" | ")}` }
      : { name: "free_quotes", ok: true, severity: "warning", detail: "model quoted text directly; matched sources" },
  ];
}

export function decideStatus(opts: { level?: Level; abstain?: boolean; checks: Check[]; citedCount: number }): Status {
  // المستوى د: لا حكم مستقل، معلومة عامة + إحالة
  if (opts.level === "D") return "referral";
  // المستوى ج: إذا لم تكفِ المصادر فالأولوية للإحالة
  if (opts.abstain) return opts.level === "C" ? "referral" : "needs_review";
  if (opts.checks.some((c) => !c.ok && c.severity === "error")) return "needs_review";
  if (opts.citedCount === 0) return "needs_review";
  return "supported";
}

/**
 * أقصر مقطع من آيات متتالية يحتوي النص المقتبس حرفياً.
 * rows: آيات من نفس السورة (أي ترتيب). يرجع null إذا ما فيه تطابق حرفي.
 */
export function findQuranSpan(
  rows: { ayah: number; text_simple: string }[],
  claim: string,
): { from: number; to: number } | null {
  const sorted = [...rows].sort((a, b) => a.ayah - b.ayah);
  for (let len = 1; len <= sorted.length; len++) {
    for (let i = 0; i + len <= sorted.length; i++) {
      const part = sorted.slice(i, i + len);
      if (part.some((r, k) => k > 0 && r.ayah !== part[k - 1].ayah + 1)) continue;
      if (containsText(part.map((r) => r.text_simple).join(" "), claim)) {
        return { from: part[0].ayah, to: part[part.length - 1].ayah };
      }
    }
  }
  return null;
}

/** النص القصير يُقبل فقط إذا كان آية كاملة (مثل ﴿قل هو الله أحد﴾) */
export function isWholeAyah(ayahSimple: string, claim: string): boolean {
  return compareWords(ayahSimple).join(" ") === compareWords(claim).join(" ");
}

import { config, disclosure, label } from "./config.ts";
import { getAyat, matchHadithText, matchQuranText } from "./db.ts";
import { findQuranSpan, isWholeAyah } from "./checks.ts";
import { packageTermSources } from "./package-terms.ts";
import { finalize, sourcePayload } from "./finalize.ts";
import { checkGlossary, findTerms, glossaryFor } from "./glossary.ts";
import { dorarMatch } from "./dorar.ts";
import { chatJSON } from "./openai.ts";
import { ASK_SYSTEM, CLASSIFY_SYSTEM, EXTRACT_SYSTEM, GENERATE_SYSTEM, GUARD_SYSTEM, TRANSLATE_SYSTEM } from "./prompts.ts";
import { dedupeSources, gradeText, hintSources, loadSources, numberSources, quranTitle, retrieve } from "./sources.ts";
import { compareWords, containsText, guessLang, wordCount } from "./text.ts";
import type { ClaimFinding, Level, ManhalResult, Source, Status } from "./types.ts";
import { HttpError } from "./types.ts";

type Out = Omit<ManhalResult, "id" | "capability">;

const need = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `'${name}' is required`);
  if (v.length > 20000) throw new HttpError(400, `'${name}' is too long (max 20000 characters)`);
  return v.trim();
};

// ───────────────────────── Ask ─────────────────────────
const AUDIENCES = ["general", "new_to_islam", "non_muslim", "child", "student"];

interface Route {
  level: Level;
  lang: string;
  search_query: string;
  out_of_scope?: boolean;
  needs_clarification?: boolean;
  clarifying_question?: string | null;
  hostile?: boolean;
  evidence_hints?: string[];
}

export async function ask(body: { question?: string; lang?: string; audience?: string }): Promise<Out> {
  const question = need(body.question, "question");
  const audience = AUDIENCES.includes(body.audience ?? "") ? body.audience : "general";
  const cls = await chatJSON<Route>(config.modelFast, CLASSIFY_SYSTEM, question);
  const lang = body.lang ?? cls.lang ?? guessLang(question);
  const level: Level = ["A", "B", "C", "D"].includes(cls.level) ? cls.level : "B";
  const base = { lang, level, sources: [] as Source[], disclosure: disclosure(lang) };

  // خارج النطاق: الحكم على الأشخاص والجماعات أو النزاعات الخاصة
  if (cls.out_of_scope) {
    return {
      ...base,
      answer: lang === "ar" ? config.referral.outOfScopeAr : config.referral.outOfScopeEn,
      status: "referral",
      status_label: label("referral", lang),
      checks: [{ name: "scope", ok: false, severity: "error", detail: "out of scope" }],
      referral: { text: lang === "ar" ? config.referral.ar : config.referral.en, url: config.referral.url },
    };
  }
  // طلب التوضيح عند الحاجة (لا يُستخدم مع الحالات الشخصية — تلك تُحال)
  if (cls.needs_clarification && cls.clarifying_question && level !== "D") {
    return {
      ...base,
      answer: cls.clarifying_question,
      status: "clarification",
      status_label: label("clarification", lang),
      checks: [{ name: "clarification", ok: true, severity: "warning" }],
    };
  }

  const terms = findTerms(`${question} ${cls.search_query ?? ""}`);
  // تعريفات قاموس المصطلحات في الحزمة تأتي أولاً، ثم الآيات والأحاديث الأقرب بالمعنى
  // ثلاث طبقات: تعريفات قاموس الحزمة، ثم الأدلة المشهورة بالبحث الحرفي، ثم الأقرب بالمعنى
  const [byMeaning, byWording] = await Promise.all([
    retrieve(`${cls.search_query ?? ""}\n${question}`, lang),
    hintSources(cls.evidence_hints, lang),
  ]);
  const sources = numberSources(
    dedupeSources([...packageTermSources(terms, lang), ...byWording, ...byMeaning]).slice(0, 14),
  );
  const out = await chatJSON<{ answer: string; abstain: boolean; abstain_reason?: string | null }>(
    config.modelGenerate,
    ASK_SYSTEM,
    {
      question,
      lang,
      level,
      audience,
      hostile: !!cls.hostile,
      sources: sourcePayload(sources, lang),
      glossary: glossaryFor(terms, lang),
    },
  );
  return finalize({ raw: out.answer ?? "", sources, lang, level, abstain: !!out.abstain, contextTerms: terms });
}

// ───────────────────────── Verify ─────────────────────────
interface Claim {
  type: "quran" | "hadith" | "attribution" | "ruling";
  text: string;
  attributed_to?: string | null;
}

export async function extractClaims(text: string): Promise<Claim[]> {
  const r = await chatJSON<{ claims: Claim[] }>(config.modelFast, EXTRACT_SYSTEM, text);
  return (r.claims ?? []).filter((c) => c?.text?.trim()).slice(0, 8);
}

function otherGrades(m: Source, ar: boolean): string {
  const rest = (m.grades ?? []).slice(1);
  if (!rest.length) return "";
  const list = rest.map((g) => `${g.grader}: ${g.grade}`).join("؛ ");
  return ar ? ` وأحكام أخرى: ${list}.` : ` Other gradings: ${list}.`;
}

function claimMessage(f: Omit<ClaimFinding, "message">, lang: string): string {
  const ar = lang === "ar";
  const m = f.match;
  switch (f.verdict) {
    case "quran_match":
      return ar ? `النص آية من القرآن الكريم (${m!.title}).` : `This is a Quran verse (${m!.title}).`;
    case "quran_mismatch":
      return ar
        ? `النص يشبه آية (${m!.title}) لكنه لا يطابق نص المصحف. النص الصحيح مرفق في المصدر.`
        : `This resembles a verse (${m!.title}) but does not match the Mushaf text. The correct text is in the source.`;
    case "authentic":
    case "hasan":
    case "weak":
    case "fabricated":
    case "graded_unknown":
      if (!f.exact) {
        // لفظ قريب من حديث ضعيف أو موضوع: نذكر حكمه، مع التنبيه أن اللفظ ليس مطابقاً
        return (ar
          ? `النص قريب من حديث في ${m!.title}، وحكمه: ${gradeText(m!, "ar")}. اللفظ ليس مطابقاً تماماً.`
          : `This is close to a hadith in ${m!.title}. Grade: ${gradeText(m!, "en")}. The wording is not an exact match.`) +
          otherGrades(m!, ar);
      }
      return (ar
        ? `الحديث موجود في ${m!.title}، وحكمه: ${gradeText(m!, "ar")}.`
        : `This hadith is in ${m!.title}. Grade: ${gradeText(m!, "en")}.`) + otherGrades(m!, ar);
    case "similar_found":
      return ar
        ? `وجدنا حديثاً قريباً في ${m!.title} (حكمه: ${gradeText(m!, "ar")})، لكن اللفظ مختلف، فيحتاج تحقق.`
        : `A similar hadith exists in ${m!.title} (grade: ${gradeText(m!, "en")}), but the wording differs. Needs review.`;
    case "not_found":
      if (f.lookup_failed) {
        return ar
          ? `لم نجد هذا النص في مصادر منهل المحلية، وتعذّر الآن الوصول إلى الموسوعة الحديثية (الدرر السنية)، فلا نستطيع الحكم عليه. أعد المحاولة لاحقاً، ولا تنشره حتى يتحقق منه مختص.`
          : `Not found in Manhal's local sources, and the Dorar Hadith Encyclopedia is unreachable right now, so we cannot grade it. Try again later and do not share it until a scholar verifies it.`;
      }
      return ar
        ? `لم نجد هذا النص في مصادر منهل، فلا نستطيع الحكم عليه. لا تنشره حتى يتحقق منه مختص.`
        : `This text was not found in Manhal's sources, so we cannot grade it. Do not share it until a scholar verifies it.`;
    case "too_short":
      return ar
        ? `النص قصير جداً للتحقق منه بدقة. أرسل النص كاملاً كما ورد.`
        : `This text is too short to verify reliably. Please send the full text as quoted.`;
    case "outside_scope":
      return ar
        ? `هذا ${f.type === "ruling" ? "حكم أو وعد" : "قول منسوب"} لا تغطيه مصادر منهل الحالية، فيحتاج تحقق من مختص.`
        : `This ${
          f.type === "ruling" ? "ruling or promise" : "attributed statement"
        } is outside Manhal's current sources. Needs review by a scholar.`;
  }
}

const PRIORITY = ["hadeethenc", "bukhari", "muslim"];

/**
 * أفضل حديث مطابق. لو تساوت المطابقة، نقدّم الصحيحين ثم ما له حكم منسوب.
 */
export async function bestHadith(text: string, lang: string): Promise<{ src: Source; score: number } | null> {
  const hits = await matchHadithText(text, 6);
  if (!hits.length) return null;
  const top = hits[0].score;
  const near = hits.filter((h) => h.score >= top - 0.02);
  const srcs = await loadSources(near.map((h) => ({ kind: "hadith" as const, ref: h.id, score: h.score })), lang);
  const rank = (s: Source) => {
    const col = s.ref.split(":")[0];
    const p = PRIORITY.indexOf(col);
    return (p >= 0 ? p : 10) + (s.grade_class && s.grade_class !== "unknown" ? 0 : 20);
  };
  // المطابق حرفياً أولاً، ثم الأعلى تشابهاً، ثم الأولوية
  const best = srcs.sort((a, b) =>
    Number(containsText(b.text, text)) - Number(containsText(a.text, text)) ||
    (b.score ?? 0) - (a.score ?? 0) || rank(a) - rank(b)
  )[0];
  return best ? { src: best, score: best.score ?? top } : null;
}

// ───────────────────────── القرآن: مطابقة حرفية ─────────────────────────
const QURAN_WINDOW = 3;

/**
 * يجد الآية بالتشابه، ثم يتأكد أن النص مطابق حرفياً لنص المصحف.
 * الاقتباس قد يمتد على أكثر من آية متتالية، فنفحص الآيات المجاورة.
 * span = null يعني لا تطابق حرفي (نص محرّف أو غير قرآني).
 */
export async function quranLookup(text: string, lang: string) {
  const words = compareWords(text);
  let [best] = await matchQuranText(text, 1);
  if (!best && words.length > 8) {
    // اقتباس طويل يمتد على أكثر من آية: نبحث بأوله
    [best] = await matchQuranText(words.slice(0, 8).join(" "), 1);
  }
  if (!best) return null;
  const keys: string[] = [];
  for (let a = Math.max(1, best.ayah - QURAN_WINDOW); a <= best.ayah + QURAN_WINDOW; a++) keys.push(`${best.surah}:${a}`);
  const rows = await getAyat(keys, lang);
  const span = findQuranSpan(rows, text);
  // النص القصير ما يُقبل إلا إذا كان آية كاملة
  const wholeAyah = !!span && span.from === span.to &&
    isWholeAyah(rows.find((r) => r.ayah === span.from)?.text_simple ?? "", text);
  const short = words.length < config.minClaimWords && !wholeAyah;
  const refs = span
    ? Array.from({ length: span.to - span.from + 1 }, (_, i) => `${best.surah}:${span.from + i}`)
    : [`${best.surah}:${best.ayah}`];
  return { surah: best.surah, score: best.score, span: short ? null : span, short, refs };
}

/** يدمج آيات متتالية في مصدر واحد للعرض */
function joinAyat(srcs: Source[], lang: string): Source {
  if (srcs.length === 1) return srcs[0];
  const s = Number(srcs[0].ref.split(":")[0]);
  const span = `${srcs[0].ref.split(":")[1]}-${srcs[srcs.length - 1].ref.split(":")[1]}`;
  return {
    ...srcs[0],
    ref: `${s}:${span}`,
    title: quranTitle(s, span, lang),
    text: srcs.map((x) => x.text).join(" "),
    translation: srcs.every((x) => x.translation) ? srcs.map((x) => x.translation).join(" ") : undefined,
    tafsir: undefined,
  };
}

export async function checkClaim(c: Claim, lang: string): Promise<ClaimFinding> {
  const t = config.threshold;
  let f: Omit<ClaimFinding, "message">;
  if (c.type === "quran") {
    const q = await quranLookup(c.text, lang);
    if (!q) f = { type: c.type, text: c.text, verdict: "not_found" };
    else if (q.short) f = { type: c.type, text: c.text, verdict: "too_short", score: q.score };
    else if (q.span) {
      const srcs = await loadSources(q.refs.map((ref) => ({ kind: "quran" as const, ref })), lang);
      f = { type: c.type, text: c.text, verdict: "quran_match", match: joinAyat(srcs, lang), score: q.score, exact: true };
    } else if (q.score >= t.similar) {
      const [src] = await loadSources([{ kind: "quran", ref: q.refs[0] }], lang);
      f = { type: c.type, text: c.text, verdict: "quran_mismatch", match: src, score: q.score, exact: false };
    } else f = { type: c.type, text: c.text, verdict: "not_found", score: q.score };
  } else if (c.type === "hadith") {
    if (wordCount(c.text) < config.minClaimWords) {
      f = { type: c.type, text: c.text, verdict: "too_short" };
    } else {
      // 1) قاعدة منهل المحلية  2) الموسوعة الحديثية في الدرر السنية (إذا ما لقينا تطابقاً حرفياً محلياً)
      const local = await bestHadith(c.text, lang);
      const localHit = local && local.score >= t.hadith ? { ...local, exact: containsText(local.src.text, c.text) } : null;
      const remote = localHit?.exact ? null : await dorarMatch(c.text, lang);
      const remoteHit = remote?.best && remote.best.score >= t.hadith ? remote.best : null;
      const lookup_failed = remote ? !remote.available : false;
      const found = [localHit, remoteHit]
        .filter((x): x is NonNullable<typeof x> => !!x)
        .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score)[0];

      if (found) {
        const cls = found.src.grade_class ?? "unknown";
        // إثبات الصحة يحتاج تطابقاً حرفياً. اللفظ القريب من حديث ضعيف أو موضوع يُذكر حكمه.
        const positive = cls === "authentic" || cls === "hasan" || cls === "unknown";
        f = found.exact || !positive
          ? {
            type: c.type,
            text: c.text,
            verdict: cls === "unknown" ? "graded_unknown" : cls,
            match: found.src,
            score: found.score,
            exact: found.exact,
            lookup_failed,
          }
          : {
            type: c.type,
            text: c.text,
            verdict: "similar_found",
            match: found.src,
            score: found.score,
            exact: false,
            lookup_failed,
          };
      } else {
        const near = [local, remote?.best]
          .filter((x): x is NonNullable<typeof x> => !!x && x.score >= t.similar)
          .sort((a, b) => b.score - a.score)[0];
        f = near
          ? {
            type: c.type,
            text: c.text,
            verdict: "similar_found",
            match: near.src,
            score: near.score,
            exact: false,
            lookup_failed,
          }
          : {
            type: c.type,
            text: c.text,
            verdict: "not_found",
            score: Math.max(local?.score ?? 0, remote?.best?.score ?? 0),
            lookup_failed,
          };
      }
    }
  } else {
    f = { type: c.type, text: c.text, verdict: "outside_scope" };
  }
  return { ...f, message: claimMessage(f, lang) };
}

const SOURCED = new Set(["quran_match", "authentic", "hasan", "weak", "fabricated"]);

export async function verify(body: { text?: string; lang?: string }): Promise<Out> {
  const text = need(body.text, "text");
  const lang = body.lang ?? guessLang(text);
  const claims = await extractClaims(text);
  const findings = await Promise.all(claims.map((c) => checkClaim(c, lang)));
  const sources = numberSources(findings.flatMap((f) => (f.match ? [f.match] : [])));
  let n = 0;
  for (const f of findings) if (f.match) f.match = sources[n++];

  const ok = findings.length > 0 && findings.every((f) => SOURCED.has(f.verdict));
  const status = ok ? "supported" : "needs_review";
  const answer = findings.length
    ? findings.map((f, i) => `${i + 1}. «${f.text.slice(0, 120)}${f.text.length > 120 ? "…" : ""}»\n${f.message}`).join("\n\n")
    : lang === "ar"
    ? "لم نجد في الرسالة آية أو حديثاً أو قولاً منسوباً للتحقق منه."
    : "No verse, hadith or attributed statement was found in this message to verify.";

  return {
    answer,
    status,
    status_label: label(status, lang),
    level: "A",
    lang,
    sources,
    claims: findings,
    disclosure: disclosure(lang),
    checks: [
      {
        name: "claims_sourced",
        ok,
        severity: "error",
        detail: `${findings.filter((f) => SOURCED.has(f.verdict)).length}/${findings.length}`,
      },
      ...(findings.some((f) => f.lookup_failed)
        ? [{ name: "dorar_reachable", ok: false, severity: "warning" as const, detail: "Dorar hadith search was unreachable" }]
        : []),
    ],
  };
}

// ───────────────────────── Translate ─────────────────────────
export async function translate(body: { text?: string; target_lang?: string }): Promise<Out> {
  const text = need(body.text, "text");
  const lang = (body.target_lang ?? "en").toLowerCase();
  if (lang === "ar") throw new HttpError(400, "target_lang must be different from Arabic");

  // 1) نحدد الآيات والأحاديث داخل النص، عشان تنعرض من الترجمة المعتمدة بدل ترجمة المودل
  const claims = (await extractClaims(text)).filter((c) => c.type === "quran" || c.type === "hadith");
  const verses: { text: string; placeholder: string }[] = [];
  const hadith: { text: string; placeholder: string; has_translation: boolean }[] = [];
  const refs: { kind: "quran" | "hadith"; ref: string }[] = [];

  for (const c of claims) {
    if (c.type === "quran") {
      // الآية تُعرض من الترجمة المعتمدة فقط إذا كانت مطابقة حرفياً للمصحف.
      // المحرّفة تبقى غير معرّفة، فيترجمها المودل بوسم [unverified] وتنزل الحالة إلى «يحتاج تحقق».
      const q = await quranLookup(c.text, lang);
      if (!q?.span) continue;
      const ref = q.span.from === q.span.to ? `${q.surah}:${q.span.from}` : `${q.surah}:${q.span.from}-${q.span.to}`;
      verses.push({ text: c.text, placeholder: `{{quran:${ref}}}` });
      for (const r of q.refs) refs.push({ kind: "quran", ref: r });
    } else {
      if (wordCount(c.text) < config.minClaimWords) continue;
      const best = await bestHadith(c.text, lang);
      if (!best || best.score < config.threshold.hadith || !containsText(best.src.text, c.text)) continue;
      hadith.push({ text: c.text, placeholder: `{{hadith:${best.src.ref}}}`, has_translation: !!best.src.translation });
      refs.push({ kind: "hadith", ref: best.src.ref });
    }
  }
  const found = numberSources(await loadSources(refs, lang));

  const terms = findTerms(text);
  const out = await chatJSON<{ translation: string }>(config.modelGenerate, TRANSLATE_SYSTEM, {
    target_lang: lang,
    text,
    identified_verses: verses,
    identified_hadith: hadith,
    glossary: glossaryFor(terms, lang),
  });
  const raw = out.translation ?? "";
  const r = await finalize({ raw, sources: found, lang, level: "A", contextTerms: terms, requireCitations: false });

  const missing = verses.filter((v) => !raw.includes(v.placeholder));
  const unverified = (raw.match(/\[unverified\]/gi) ?? []).length;
  r.checks.push(
    missing.length
      ? {
        name: "verses_from_approved_translation",
        ok: false,
        severity: "error",
        detail: `${missing.length} identified verse(s) were translated by the model`,
      }
      : { name: "verses_from_approved_translation", ok: true, severity: "error", detail: `${verses.length} verse(s)` },
  );
  if (unverified) {
    r.checks.push({
      name: "unverified_quotes",
      ok: false,
      severity: "error",
      detail: `${unverified} quote(s) not found in sources`,
    });
  }
  if (r.checks.some((c) => !c.ok && c.severity === "error")) {
    r.status = "needs_review";
    r.status_label = label("needs_review", lang);
  }
  return r;
}

// ───────────────────────── Guard ─────────────────────────
export async function guard(body: { question?: string; answer?: string; lang?: string }): Promise<Out> {
  const question = need(body.question, "question");
  const answer = need(body.answer, "answer");
  const lang = body.lang ?? guessLang(answer);

  // التصنيف بالتوازي (ما يزيد وقت الرد): الحالة الشخصية تُحال، ونصها ما يُحفظ في السجل
  const [claims, sources, cls] = await Promise.all([
    extractClaims(answer).then((cs) => Promise.all(cs.map((c) => checkClaim(c, lang)))),
    retrieve(question, lang),
    chatJSON<Route>(config.modelFast, CLASSIFY_SYSTEM, question).catch((e) => {
      console.error("guard classify failed:", String(e));
      return null;
    }),
  ]);
  const level: Level | undefined = cls && ["A", "B", "C", "D"].includes(cls.level) ? cls.level : undefined;
  const terms = findTerms(`${question} ${answer}`);
  const termIssues = checkGlossary(answer, guessLang(answer), terms).filter((c) => !c.ok);

  const judge = await chatJSON<{ verdict: "ok" | "issue"; issues: { type: string; detail: string }[]; corrected_answer: string }>(
    config.modelGenerate,
    GUARD_SYSTEM,
    {
      question,
      answer,
      lang,
      sources: sourcePayload(sources, lang),
      claim_findings: claims.map((c) => ({ text: c.text, verdict: c.verdict, finding: c.message })),
      glossary: glossaryFor(terms, lang),
    },
  );

  const issues = [...(judge.issues ?? [])];
  for (const c of claims) {
    if (["fabricated", "weak"].includes(c.verdict)) issues.push({ type: "weak_evidence", detail: c.message });
    if (c.verdict === "not_found" && c.lookup_failed) issues.push({ type: "unverified", detail: c.message });
    else if (["not_found", "quran_mismatch", "similar_found"].includes(c.verdict)) {
      issues.push({ type: "wrong_attribution", detail: c.message });
    }
  }
  for (const t of termIssues) issues.push({ type: "terminology", detail: t.detail ?? t.name });
  const unique = issues.filter((x, i) => issues.findIndex((y) => y.type === x.type && y.detail === x.detail) === i);
  const verdict = unique.length ? "issue" : "ok";

  const correction = judge.corrected_answer?.trim()
    ? await finalize({ raw: judge.corrected_answer, sources, lang, level, contextTerms: terms })
    : undefined;

  const status: Status = level === "D" ? "referral" : correction?.status ?? "needs_review";
  const referral = status === "referral"
    ? correction?.referral ?? { text: lang === "ar" ? config.referral.ar : config.referral.en, url: config.referral.url }
    : undefined;

  return {
    answer: verdict === "ok" ? answer : correction?.answer ?? answer,
    status,
    status_label: label(status, lang),
    level,
    lang,
    sources: correction?.sources ?? [],
    checks: correction?.checks ?? [],
    disclosure: disclosure(lang),
    referral,
    verdict,
    issues: unique,
    claims,
    correction,
  };
}

// ───────────────────────── Generate ─────────────────────────
export async function generate(body: { topic?: string; lang?: string }): Promise<Out> {
  const topic = need(body.topic, "topic");
  const lang = body.lang ?? guessLang(topic);
  const sources = await retrieve(topic, lang, 14);
  const terms = findTerms(topic);
  const out = await chatJSON<{ title: string; sections: { heading: string; points: string[] }[]; abstain: boolean }>(
    config.modelGenerate,
    GENERATE_SYSTEM,
    { topic, lang, sources: sourcePayload(sources, lang), glossary: glossaryFor(terms, lang) },
  );
  const raw = [
    `# ${out.title ?? topic}`,
    ...(out.sections ?? []).map((s) => `## ${s.heading}\n${(s.points ?? []).map((p) => `- ${p}`).join("\n")}`),
  ].join("\n\n");
  return finalize({ raw, sources, lang, level: "B", abstain: !!out.abstain, contextTerms: terms });
}

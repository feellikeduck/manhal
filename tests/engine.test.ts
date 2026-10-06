import { deepStrictEqual as assertEquals, ok as assert } from "node:assert/strict";
import { classifyGrade, containsText, guessLang, normalizeAr, primaryGrade } from "../supabase/functions/manhal/lib/text.ts";
import { parsePlaceholders } from "../supabase/functions/manhal/lib/resolve.ts";
import { checkGlossary, findTerms } from "../supabase/functions/manhal/lib/glossary.ts";
import {
  checkCitations,
  decideStatus,
  extractQuotes,
  findQuranSpan,
  isWholeAyah,
} from "../supabase/functions/manhal/lib/checks.ts";
import { fromChatRequest } from "../supabase/functions/manhal/lib/openai-compat.ts";
import { routeOf } from "../supabase/functions/manhal/lib/http.ts";
import { overlap, parseDorar } from "../supabase/functions/manhal/lib/dorar.ts";
import type { Source } from "../supabase/functions/manhal/lib/types.ts";

Deno.test("normalizeAr: تشكيل وهمزات وتاء مربوطة", () => {
  assertEquals(normalizeAr("إنّما الأعمالُ بالنيّات"), "انما الاعمال بالنيات");
  assertEquals(normalizeAr("ٱللَّهُ لَآ إِلَٰهَ إِلَّا هُوَ"), "الله لا اله الا هو");
  assertEquals(normalizeAr("الصلاةُ، والزكاةُ!"), "الصلاه والزكاه");
  assertEquals(normalizeAr("سِنَةࣱ وَلَا نَوۡمࣱۚ"), "سنه ولا نوم");
});

Deno.test("classifyGrade يقرأ الحكم كما ورد", () => {
  assertEquals(classifyGrade("Sahih"), "authentic");
  assertEquals(classifyGrade("Hasan Sahih"), "authentic");
  assertEquals(classifyGrade("Isnaad Hasan"), "hasan");
  assertEquals(classifyGrade("Daif"), "weak");
  assertEquals(classifyGrade("Very Daif"), "weak");
  assertEquals(classifyGrade("Maudu"), "fabricated");
  assertEquals(classifyGrade("موضوع"), "fabricated");
  assertEquals(
    primaryGrade([{ grader: "Zubair Ali Zai", grade: "Daif" }, { grader: "Al-Albani", grade: "Sahih" }]).cls,
    "authentic",
  );
});

Deno.test("parsePlaceholders", () => {
  const p = parsePlaceholders("قال تعالى {{quran:2:255}} و{{quran:112:1-4}} و{{hadith:bukhari:1}} و{{quran:115:1}}");
  assertEquals(p.length, 4);
  assertEquals(p[0].keys, ["2:255"]);
  assertEquals(p[1].keys, ["112:1", "112:2", "112:3", "112:4"]);
  assertEquals(p[2].keys, ["bukhari:1"]);
  assertEquals(p[3].valid, false);
});

Deno.test("findTerms يتعرف على المصطلحات مع السوابق", () => {
  const ids = findTerms("وأقيموا الصلاة وآتوا الزكاة، والصيامُ جنة").map((t) => t.id);
  assert(ids.includes("salah"));
  assert(ids.includes("zakah"));
  assert(ids.includes("sawm"));
  assert(findTerms("بالوضوء").some((t) => t.id === "wudu"));
});

Deno.test("checkGlossary: الممنوع خطأ، والتنبيه في سياقه فقط", () => {
  const bad = checkGlossary("Jihad means holy war.", "en");
  assert(bad.some((c) => c.name === "glossary_forbidden" && !c.ok));
  const okTopic = checkGlossary("The topic of today's sermon is patience.", "en", []);
  assert(okTopic.every((c) => c.ok));
  const zakah = checkGlossary("Pay your charity every year.", "en", findTerms("الزكاة"));
  assert(zakah.some((c) => c.name === "glossary_caution"));
  assertEquals(checkGlossary("أي نص", "ar"), []);
});

Deno.test("extractQuotes يلتقط الاقتباسات العربية الطويلة فقط", () => {
  const q = extractQuotes('قال: «إنما الأعمال بالنيات وإنما لكل امرئ ما نوى» وقال "نعم" و﴿الله لا إله إلا هو الحي القيوم﴾');
  assertEquals(q.length, 2);
});

Deno.test("checkCitations و decideStatus", () => {
  const sources = [{ sid: "S1" }, { sid: "S2" }] as Source[];
  const r = checkCitations("كذا [S1] وكذا [S3]", sources);
  assertEquals(r.cited, ["S1"]);
  assert(!r.checks[0].ok);
  assertEquals(decideStatus({ checks: r.checks, citedCount: 1 }), "needs_review");
  assertEquals(decideStatus({ checks: [], citedCount: 2 }), "supported");
  assertEquals(decideStatus({ level: "D", checks: [], citedCount: 2 }), "referral");
  assertEquals(decideStatus({ level: "C", abstain: true, checks: [], citedCount: 0 }), "referral");
  assertEquals(decideStatus({ level: "B", abstain: true, checks: [], citedCount: 0 }), "needs_review");
  assertEquals(decideStatus({ checks: [], citedCount: 0 }), "needs_review");
});

Deno.test("OpenAI-compatible request mapping", () => {
  const a = fromChatRequest({ model: "manhal", messages: [{ role: "user", content: "ما فضل الصدقة؟" }] });
  assertEquals(a, { capability: "ask", input: { question: "ما فضل الصدقة؟", lang: undefined } });
  const g = fromChatRequest({
    model: "manhal-guard",
    messages: [
      { role: "system", content: "x" },
      { role: "user", content: "سؤال" },
      { role: "assistant", content: [{ type: "text", text: "جواب" }] },
    ],
  });
  assertEquals(g.input, { question: "سؤال", answer: "جواب", lang: undefined });
  const t = fromChatRequest({ model: "manhal-translate", target_lang: "ur", messages: [{ role: "user", content: "نص" }] });
  assertEquals(t.input.target_lang, "ur");
});

Deno.test("routeOf", () => {
  assertEquals(routeOf(new URL("https://x.supabase.co/functions/v1/manhal/v1/chat/completions")), "/v1/chat/completions");
  assertEquals(routeOf(new URL("http://localhost:54321/manhal/v1/ask/")), "/v1/ask");
  assertEquals(guessLang("What is Zakah?"), "en");
});

Deno.test("parseDorar يقرأ نتائج الموسوعة الحديثية", () => {
  const html = `<div class="hadith" style="text-align:justify;">1 - اطلبوا العلم ولو بالصين</div>
<div class="hadith-info"><span class="info-subtitle">الراوي:</span> أنس بن مالك | <span class="info-subtitle">المحدث:</span>الألباني | <span class="info-subtitle">المصدر:</span>السلسلة الضعيفة | <span class="info-subtitle">الصفحة أو الرقم:</span>416 | <span class="info-subtitle">خلاصة حكم المحدث:</span> <span>[باطل]</span></div>`;
  const [h] = parseDorar(html);
  assertEquals(h.text, "اطلبوا العلم ولو بالصين");
  assertEquals(h.mohdith, "الألباني");
  assertEquals(h.book, "السلسلة الضعيفة");
  assertEquals(h.grade, "باطل");
  assertEquals(classifyGrade(h.grade!), "fabricated");
  assert(overlap("اطلبوا العلم ولو في الصين", h.text) >= 0.6);
});

Deno.test("containsText: التشابه ما يكفي، لازم تطابق حرفي", () => {
  const h = "عن عمر رضي الله عنه قال: سمعت رسول الله ﷺ يقول: «إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى»";
  assert(containsText(h, "إنما الأعمال بالنيات"));
  assert(containsText(h, "إنما الأعمال بالنيات وإنما لكل امرئ ما نوى"));
  assert(!containsText(h, "إنما الأعمال بالنية")); // كلمة مغيّرة
  assert(!containsText(h, "إنما لكل امرئ الأعمال")); // ترتيب مختلف
  assert(!containsText(h, ""));
});

const IKHLAS = [
  { ayah: 1, text_simple: "قل هو الله أحد" },
  { ayah: 2, text_simple: "الله الصمد" },
  { ayah: 3, text_simple: "لم يلد ولم يولد" },
  { ayah: 4, text_simple: "ولم يكن له كفوا أحد" },
];

Deno.test("findQuranSpan: آية واحدة، وآيات متتالية، والمحرّف يُرفض", () => {
  assertEquals(findQuranSpan(IKHLAS, "لَمْ يَلِدْ وَلَمْ يُولَدْ"), { from: 3, to: 3 });
  assertEquals(findQuranSpan(IKHLAS, "الله الصمد لم يلد ولم يولد"), { from: 2, to: 3 });
  assertEquals(findQuranSpan([...IKHLAS].reverse(), "الله الصمد لم يلد ولم يولد"), { from: 2, to: 3 });
  assertEquals(findQuranSpan(IKHLAS, "ولم يكن له كفؤا أحد"), { from: 4, to: 4 }); // ؤ = و بعد التوحيد
  assertEquals(findQuranSpan(IKHLAS, "لم يلد ولم يولد له"), null); // زيادة كلمة
  assertEquals(findQuranSpan(IKHLAS, "قل هو الله واحد"), null); // كلمة مغيّرة
  // آيات غير متتالية ما تنضم لبعض
  assertEquals(findQuranSpan([IKHLAS[0], IKHLAS[2]], "قل هو الله أحد لم يلد"), null);
});

Deno.test("isWholeAyah: النص القصير يُقبل إذا كان آية كاملة فقط", () => {
  assert(isWholeAyah("قل هو الله أحد", "قُلْ هُوَ اللَّهُ أَحَدٌ"));
  assert(!isWholeAyah("قل هو الله أحد", "الله أحد"));
});

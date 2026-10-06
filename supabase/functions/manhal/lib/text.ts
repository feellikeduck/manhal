import type { Grade, GradeClass } from "./types.ts";

const MARKS = /[\u064B-\u065F\u0670\u0640\u06D6-\u06ED\u08D3-\u08FF\u200C-\u200F]/g;
const LETTER_MAP: Record<string, string> = {
  "ٱ": "ا",
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ى": "ي",
  "ی": "ي",
  "ة": "ه",
  "ؤ": "و",
  "ئ": "ي",
};

/** نفس منطق normalize_ar في قاعدة البيانات بالضبط */
export function normalizeAr(t: string): string {
  return (t ?? "")
    .replace(MARKS, "")
    .replace(/[ٱأإآىیةؤئ]/g, (c) => LETTER_MAP[c])
    .replace(/[^\u0621-\u064A0-9a-zA-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isArabic(t: string): boolean {
  const ar = (t.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  return ar >= latin;
}

export function guessLang(t: string): string {
  return isArabic(t) ? "ar" : "en";
}

export function wordCount(t: string): number {
  return normalizeAr(t).split(" ").filter(Boolean).length;
}

/** تصنيف حكم واحد كما ورد في المصدر — منهل لا يحكم بنفسه */
export function classifyGrade(grade: string): GradeClass {
  const g = grade.toLowerCase();
  if (/(maudu|mawdu|fabricat|موضوع|مكذوب|باطل|لا أصل له|لا اصل له|كذب)/.test(g)) return "fabricated";
  if (/(da'?if|daif|weak|munkar|shadh|ضعيف|منكر|شاذ|لا يصح|لا يثبت)/.test(g)) return "weak";
  if (/(sahih|صحيح|authentic|agreed)/.test(g)) return "authentic";
  if (/(hasan|حسن|sound)/.test(g)) return "hasan";
  return "unknown";
}

/** الحكم المعتمد للعرض: الألباني إن وُجد، وإلا أول حكم */
export function primaryGrade(grades: Grade[] | undefined): { cls: GradeClass; grade?: Grade } {
  if (!grades?.length) return { cls: "unknown" };
  const g = grades.find((x) => /albani|الألباني/i.test(x.grader)) ?? grades[0];
  return { cls: classifyGrade(g.grade), grade: g };
}

/** يقص النص للمودل بدون كسر الكلمات */
export function clip(t: string, max = 1500): string {
  if (!t || t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")) + " …";
}

/** كلمات النص للمقارنة الحرفية: نفس التوحيد + حذف الأرقام والهمزة المفردة */
export function compareWords(t: string): string[] {
  return normalizeAr(t).replace(/[0-9]/g, " ").replace(/ء/g, "").split(" ").filter(Boolean);
}

/**
 * هل النص المقتبس موجود في المصدر حرفياً وبنفس الترتيب (بعد التوحيد)؟
 * التشابه وحده ما يكفي: كلمة واحدة مغيّرة في نص طويل تعطي تشابهاً عالياً.
 */
export function containsText(source: string, claim: string): boolean {
  const c = compareWords(claim);
  if (!c.length) return false;
  return ` ${compareWords(source).join(" ")} `.includes(` ${c.join(" ")} `);
}

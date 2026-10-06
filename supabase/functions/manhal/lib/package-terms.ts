// «نماذج لقاموس المصطلحات الأساسية» — المرجعية والحزمة العلمية للتحدي، صفحة 7 (نسخة 20/3/1448).
// النص كما ورد في الحزمة. هذه مصادر يُستشهد بها لتعريف المصطلح، مثل الآيات والأحاديث.
import type { Term } from "./glossary.ts";
import type { Source } from "./types.ts";

const PACKAGE_TERMS: Record<string, { ar: string; en: string; text: string }> = {
  islam: {
    ar: "الإسلام",
    en: "Islam",
    text: "دين الاستسلام لله بالتوحيد والانقياد له بالطاعة، ويشرح بحسب السياق ولا يختزل في معنى ثقافي عام.",
  },
  tawhid: {
    ar: "التوحيد",
    en: "Tawhid / Oneness of God",
    text:
      "يفضل إبقاء المصطلح مع شرح معناه إفراد الله بالربوبية والألوهية ووصفه بما جاء الوحي به من أسمائه الحسنى، ولا يختزل في ترجمة قد توحي بمجرد الوحدانية العددية.",
  },
  ibadah: {
    ar: "العبادة",
    en: "Worship",
    text: "تشمل أعمال القلب والقول والعمل التي يتقرب بها العبد إلى الله، ولا تحصر في الشعائر فقط.",
  },
  nubuwwah: {
    ar: "النبوة",
    en: "Prophethood",
    text: "تستخدم للدلالة على اصطفاء الأنبياء بالوحي، مع التمييز بينها وبين القيادة الدينية البشرية.",
  },
  wahy: {
    ar: "الوحي",
    en: "Revelation",
    text: "يشرح بوصفه ما أوحاه الله إلى أنبيائه، مع تجنب استعمالات فضفاضة قد توهم الإلهام الشخصي.",
  },
  shariah: {
    ar: "الشريعة",
    en: "Sharia / Islamic law and guidance",
    text: "يشرح بحسب السياق، ولا يختزل في العقوبات أو القانون الجنائي.",
  },
  hadith: {
    ar: "الحديث",
    en: "Hadith",
    text: "ما نُقل عن النبي ﷺ من قول أو فعل أو تقرير ونحو ذلك، مع بيان درجة الثبوت عند الاستدلال.",
  },
  sunnah: {
    ar: "السنة",
    en: "Sunnah",
    text: "هدي النبي ﷺ وطريقته، ويحدد المقصود بحسب السياق العلمي.",
  },
  fatwa: {
    ar: "الفتوى",
    en: "Fatwa",
    text: "جواب شرعي يصدره مؤهل في واقعة أو سؤال، ولا يساوى بالمعلومة العامة.",
  },
  dawah: {
    ar: "الدعوة",
    en: "Da'wah / Invitation to Islam",
    text: "التعريف بالإسلام والدعوة إليه بالحكمة، ويختار المقابل بحسب السياق والجمهور.",
  },
};

/** تعريفات الحزمة للمصطلحات الواردة في السؤال (بحد أقصى 3) كمصادر */
export function packageTermSources(terms: Term[], lang: string): Source[] {
  const out: Source[] = [];
  for (const t of terms) {
    const p = PACKAGE_TERMS[t.id];
    if (!p || out.some((s) => s.ref === `term:${t.id}`)) continue;
    out.push({
      sid: "",
      type: "term",
      ref: `term:${t.id}`,
      title: lang === "ar"
        ? `قاموس المصطلحات — الحزمة العلمية للتحدي: ${p.ar}`
        : `Challenge glossary (scientific package): ${p.en}`,
      text: `${p.ar}: ${p.text}`,
      translation: lang === "ar" ? undefined : p.en,
      source_id: "package-glossary",
    });
    if (out.length >= 3) break;
  }
  return out;
}

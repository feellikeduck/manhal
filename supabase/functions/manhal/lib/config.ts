const env = (k: string, d: string) => Deno.env.get(k) ?? d;

export const config = {
  openaiKey: () => {
    const k = Deno.env.get("OPENAI_API_KEY");
    if (!k) throw new Error("OPENAI_API_KEY is not set");
    return k;
  },
  openaiBase: env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
  // اسم المودل متغيّر في الإعدادات: منهل مستقل عن المودل
  modelGenerate: env("MANHAL_MODEL_GENERATE", "gpt-6-astra"),
  modelFast: env("MANHAL_MODEL_FAST", "gpt-6-astra"),
  modelEmbed: env("MANHAL_MODEL_EMBED", "text-embedding-3-small"),
  referral: {
    url: env("MANHAL_REFERRAL_URL", "https://www.alifta.gov.sa"),
    outOfScopeAr:
      "هذا السؤال خارج نطاق منهل: منهل لا يحكم على الأشخاص أو الجماعات، ولا يفصل في النزاعات الخاصة. ننصحك بعرضه على أهل العلم أو الجهة المختصة.",
    outOfScopeEn:
      "This is outside Manhal's scope: Manhal does not pass judgment on individuals or groups, or settle private disputes. Please consult scholars or the competent authority.",
    ar: env(
      "MANHAL_REFERRAL_AR",
      "هذا سؤال يتعلق بحالتك الشخصية، والحكم فيه يختلف باختلاف التفاصيل. ننصحك بعرضه على جهة إفتاء معتمدة.",
    ),
    en: env(
      "MANHAL_REFERRAL_EN",
      "This question depends on your personal circumstances. Please consult a qualified scholar or an official fatwa authority.",
    ),
  },
  threshold: {
    quran: Number(env("MANHAL_TH_QURAN", "0.85")),
    hadith: Number(env("MANHAL_TH_HADITH", "0.8")),
    similar: Number(env("MANHAL_TH_SIMILAR", "0.6")),
    quote: Number(env("MANHAL_TH_QUOTE", "0.85")),
  },
  retrieveK: Number(env("MANHAL_RETRIEVE_K", "10")),
  // أقل عدد كلمات لنص نحكم عليه (أقصر من كذا يتطابق مع نصوص كثيرة)
  minClaimWords: Number(env("MANHAL_MIN_CLAIM_WORDS", "3")),
};

export const STATUS_LABEL = {
  supported: { ar: "مؤيَّد", en: "Supported" },
  needs_review: { ar: "يحتاج تحقق", en: "Needs review" },
  referral: { ar: "إحالة للمختص", en: "Refer to a scholar" },
  clarification: { ar: "يحتاج توضيح", en: "Needs clarification" },
} as const;

export const LEVEL_LABEL = {
  A: { ar: "معلومات أصلية مستقرة", en: "Established core information" },
  B: { ar: "شرح وتعريف واستدلال", en: "Explanation and reasoning" },
  C: { ar: "مسألة خلافية أو عالية الحساسية", en: "Disputed or highly sensitive matter" },
  D: { ar: "فتوى أو حالة شخصية", en: "Personal case or fatwa" },
} as const;

/** الشفافية: منهل يفصح عن طبيعته */
export function disclosure(lang: string) {
  return lang === "ar"
    ? "منهل أداة مدعومة بالذكاء الاصطناعي تجيب من مصادر معتمدة، وليست مفتياً ولا بديلاً عن أهل العلم."
    : "Manhal is an AI-powered tool that answers from approved sources. It is not a mufti or a substitute for scholars.";
}

export function label(status: keyof typeof STATUS_LABEL, lang: string) {
  return lang === "ar" ? STATUS_LABEL[status].ar : STATUS_LABEL[status].en;
}

export const SURAH_AR = [
  "",
  "الفاتحة",
  "البقرة",
  "آل عمران",
  "النساء",
  "المائدة",
  "الأنعام",
  "الأعراف",
  "الأنفال",
  "التوبة",
  "يونس",
  "هود",
  "يوسف",
  "الرعد",
  "إبراهيم",
  "الحجر",
  "النحل",
  "الإسراء",
  "الكهف",
  "مريم",
  "طه",
  "الأنبياء",
  "الحج",
  "المؤمنون",
  "النور",
  "الفرقان",
  "الشعراء",
  "النمل",
  "القصص",
  "العنكبوت",
  "الروم",
  "لقمان",
  "السجدة",
  "الأحزاب",
  "سبأ",
  "فاطر",
  "يس",
  "الصافات",
  "ص",
  "الزمر",
  "غافر",
  "فصلت",
  "الشورى",
  "الزخرف",
  "الدخان",
  "الجاثية",
  "الأحقاف",
  "محمد",
  "الفتح",
  "الحجرات",
  "ق",
  "الذاريات",
  "الطور",
  "النجم",
  "القمر",
  "الرحمن",
  "الواقعة",
  "الحديد",
  "المجادلة",
  "الحشر",
  "الممتحنة",
  "الصف",
  "الجمعة",
  "المنافقون",
  "التغابن",
  "الطلاق",
  "التحريم",
  "الملك",
  "القلم",
  "الحاقة",
  "المعارج",
  "نوح",
  "الجن",
  "المزمل",
  "المدثر",
  "القيامة",
  "الإنسان",
  "المرسلات",
  "النبأ",
  "النازعات",
  "عبس",
  "التكوير",
  "الانفطار",
  "المطففين",
  "الانشقاق",
  "البروج",
  "الطارق",
  "الأعلى",
  "الغاشية",
  "الفجر",
  "البلد",
  "الشمس",
  "الليل",
  "الضحى",
  "الشرح",
  "التين",
  "العلق",
  "القدر",
  "البينة",
  "الزلزلة",
  "العاديات",
  "القارعة",
  "التكاثر",
  "العصر",
  "الهمزة",
  "الفيل",
  "قريش",
  "الماعون",
  "الكوثر",
  "الكافرون",
  "النصر",
  "المسد",
  "الإخلاص",
  "الفلق",
  "الناس",
];

export const COLLECTIONS: Record<string, { ar: string; en: string }> = {
  dorar: { ar: "الموسوعة الحديثية — الدرر السنية", en: "Dorar Hadith Encyclopedia" },
  bukhari: { ar: "صحيح البخاري", en: "Sahih al-Bukhari" },
  muslim: { ar: "صحيح مسلم", en: "Sahih Muslim" },
  abudawud: { ar: "سنن أبي داود", en: "Sunan Abi Dawud" },
  tirmidhi: { ar: "جامع الترمذي", en: "Jami' at-Tirmidhi" },
  nasai: { ar: "سنن النسائي", en: "Sunan an-Nasa'i" },
  ibnmajah: { ar: "سنن ابن ماجه", en: "Sunan Ibn Majah" },
  malik: { ar: "موطأ مالك", en: "Muwatta Malik" },
  nawawi: { ar: "الأربعون النووية", en: "Forty Hadith of an-Nawawi" },
  qudsi: { ar: "الأحاديث القدسية", en: "Forty Hadith Qudsi" },
  hadeethenc: { ar: "موسوعة الأحاديث النبوية", en: "HadeethEnc" },
};

export const GRADE_LABEL: Record<string, { ar: string; en: string }> = {
  authentic: { ar: "صحيح", en: "authentic (Sahih)" },
  hasan: { ar: "حسن", en: "sound (Hasan)" },
  weak: { ar: "ضعيف", en: "weak (Da'if)" },
  fabricated: { ar: "موضوع (مكذوب)", en: "fabricated (Mawdu')" },
  unknown: { ar: "غير محدد", en: "not specified" },
};

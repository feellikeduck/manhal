export type Status = "supported" | "needs_review" | "referral" | "clarification";
/**
 * مستويات المحتوى الأربعة كما في الحزمة العلمية للتحدي:
 * A معلومات أصلية مستقرة · B شرح وتعريف واستدلال · C مسائل خلافية أو عالية الحساسية · D فتوى أو حالة شخصية
 */
export type Level = "A" | "B" | "C" | "D";
export type Capability = "ask" | "translate" | "verify" | "guard" | "generate";
export type GradeClass = "authentic" | "hasan" | "weak" | "fabricated" | "unknown";

export interface Grade {
  grader: string;
  grade: string;
}

/** مصدر واحد يُعطى للمودل ويرجع للمطور */
export interface Source {
  sid: string; // S1, S2 ...
  type: "quran" | "hadith";
  ref: string; // "2:255" أو "bukhari:1"
  title: string; // "البقرة: 255" أو "صحيح البخاري، 1"
  text: string; // النص العربي كما في المصدر
  translation?: string;
  tafsir?: string;
  grades?: Grade[];
  grade_class?: GradeClass;
  source_id?: string;
  score?: number;
}

export interface Check {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  detail?: string;
}

export interface ManhalResult {
  id: string;
  capability: Capability;
  answer: string;
  status: Status;
  status_label: string;
  level?: Level;
  lang: string;
  sources: Source[];
  checks: Check[];
  referral?: { text: string; url: string };
  disclosure: string;
  // verify / guard
  claims?: ClaimFinding[];
  verdict?: "ok" | "issue";
  issues?: { type: string; detail: string }[];
  correction?: Omit<ManhalResult, "id" | "capability" | "claims" | "verdict" | "issues" | "correction">;
}

export type ClaimVerdict =
  | "quran_match"
  | "quran_mismatch"
  | "authentic"
  | "hasan"
  | "weak"
  | "fabricated"
  | "graded_unknown"
  | "similar_found"
  | "not_found"
  | "too_short"
  | "outside_scope";

export interface ClaimFinding {
  type: "quran" | "hadith" | "attribution" | "ruling";
  text: string;
  verdict: ClaimVerdict;
  message: string;
  match?: Source;
  score?: number;
  /** النص مطابق حرفياً للمصدر (لا مجرد تشابه) */
  exact?: boolean;
  /** تعذّر الوصول للموسوعة الحديثية وقت التحقق */
  lookup_failed?: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "invalid_request_error") {
    super(message);
  }
}

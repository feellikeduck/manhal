// الموسوعة الحديثية — الدرر السنية (مرجع معتمد في الحزمة العلمية للتحدي)
// واجهة البحث العامة: https://dorar.net/dorar_api.json?skey=...  (dorar.net/article/389)
// تُستخدم في التحقق عندما لا يوجد الحديث في قاعدة منهل المحلية، وتشمل الأحاديث المنتشرة التي لا تثبت.
import { classifyGrade, containsText, normalizeAr } from "./text.ts";
import type { Source } from "./types.ts";

const DORAR_URL = Deno.env.get("MANHAL_DORAR_URL") ?? "https://dorar.net/dorar_api.json";
const ENABLED = (Deno.env.get("MANHAL_DORAR") ?? "on") !== "off";

export interface DorarHit {
  text: string;
  rawi?: string;
  mohdith?: string;
  book?: string;
  number?: string;
  grade?: string;
}

const strip = (h: string) =>
  h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const FIELDS: [keyof DorarHit, string][] = [
  ["rawi", "الراوي"],
  ["mohdith", "المحدث"],
  ["book", "المصدر"],
  ["number", "الصفحة أو الرقم"],
  ["grade", "خلاصة حكم المحدث"],
];

/** يحلل HTML الذي ترجعه واجهة الدرر */
export function parseDorar(html: string): DorarHit[] {
  const hits: DorarHit[] = [];
  const blocks = html.split(/<div[^>]*class="hadith"[^>]*>/).slice(1);
  for (const b of blocks) {
    const end = b.indexOf("</div>");
    const text = strip(end >= 0 ? b.slice(0, end) : b).replace(/^\d+\s*-\s*/, "");
    const infoStart = b.indexOf('class="hadith-info"');
    const info = infoStart >= 0 ? b.slice(infoStart) : "";
    const hit: DorarHit = { text };
    for (const [key, label] of FIELDS) {
      const m = info.match(new RegExp(`${label}\\s*:?\\s*</span>([\\s\\S]*?)(?=<span[^>]*class="info-subtitle"|</div>|$)`));
      if (m) {
        const v = strip(m[1]).replace(/^\|+|\|+$/g, "").replace(/[\[\]]/g, "").trim();
        if (v) (hit as any)[key] = v;
      }
    }
    if (hit.text) hits.push(hit);
  }
  return hits;
}

/** نسبة كلمات النص المرسل الموجودة في نص الحديث (بعد التوحيد) */
export function overlap(claim: string, text: string): number {
  const c = normalizeAr(claim).split(" ").filter((w) => w.length > 1);
  if (!c.length) return 0;
  const t = new Set(normalizeAr(text).split(" "));
  return c.filter((w) => t.has(w)).length / c.length;
}

function findHtml(v: unknown): string | null {
  if (typeof v === "string") return v.includes('class="hadith"') ? v : null;
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) {
      const h = findHtml(x);
      if (h) return h;
    }
  }
  return null;
}

/** يرجع null إذا تعذّر الوصول (عشان ما نقول «لم نجده» وهو بس ما وصلنا) */
export async function searchDorar(q: string): Promise<DorarHit[] | null> {
  if (!ENABLED) return [];
  const key = normalizeAr(q).split(" ").slice(0, 12).join(" ");
  try {
    const r = await fetch(`${DORAR_URL}?skey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) {
      console.error("dorar lookup failed: HTTP", r.status);
      return null;
    }
    const raw = await r.text();
    let html: string | null;
    try {
      html = findHtml(JSON.parse(raw));
    } catch {
      html = raw.includes('class="hadith"') ? raw : null;
    }
    return html ? parseDorar(html) : [];
  } catch (e) {
    console.error("dorar lookup failed:", String(e));
    return null;
  }
}

/** أفضل تطابق من الدرر كمصدر في منهل، مع أحكام المحدثين كما وردت. المطابق حرفياً يتقدم. */
export async function dorarMatch(
  claim: string,
  lang: string,
): Promise<{ best: { src: Source; score: number; exact: boolean } | null; available: boolean }> {
  const found = await searchDorar(claim);
  if (found === null) return { best: null, available: false };
  const hits = found
    .map((h) => ({ h, score: overlap(claim, h.text), exact: containsText(h.text, claim) }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score);
  if (!hits.length) return { best: null, available: true };
  const top = hits[0];
  // أحكام نفس الحديث فقط: المطابق مثل الأول (حرفياً أو بنفس الدرجة تقريباً)
  const graded = hits
    .filter((x) => x.exact === top.exact && x.score >= top.score - 0.1 && x.h.grade)
    .slice(0, 3);
  const grades = graded.map((x) => ({ grader: [x.h.mohdith, x.h.book].filter(Boolean).join(" — "), grade: x.h.grade! }));
  const book = top.h.book ?? (lang === "ar" ? "الموسوعة الحديثية" : "Dorar Hadith Encyclopedia");
  return {
    available: true,
    best: {
      score: top.score,
      exact: top.exact,
      src: {
        sid: "",
        type: "hadith",
        ref: `dorar:${top.h.book ?? ""}:${top.h.number ?? ""}`,
        title: lang === "ar"
          ? `${book}${top.h.number ? `، ${top.h.number}` : ""} (عبر الدرر السنية)`
          : `${book}${top.h.number ? ` ${top.h.number}` : ""} (via Dorar)`,
        text: top.h.text,
        grades,
        grade_class: grades.length ? classifyGrade(grades[0].grade) : "unknown",
        source_id: "dorar",
      },
    },
  };
}

// تجربة سريعة للمحرك الحي على 4 حالات من الحزمة العلمية
// التشغيل (من مجلد manhal):  deno run -A --env-file=.env scripts/smoke.ts
// يحتاج في .env:  MANHAL_API_URL  و  MANHAL_TEST_KEY  (مفتاح secret من deno task key)

const URL_ = Deno.env.get("MANHAL_API_URL")?.trim().replace(/\/+$/, "");
const KEY = Deno.env.get("MANHAL_TEST_KEY")?.trim();
if (!URL_ || !KEY) {
  console.error("❌ أضف MANHAL_API_URL و MANHAL_TEST_KEY في .env");
  Deno.exit(1);
}

type Case = { name: string; path: string; body: Record<string, unknown>; expect: (r: any) => boolean; want: string };

const cases: Case[] = [
  {
    name: "آية صحيحة",
    path: "/v1/verify",
    body: { text: "قال تعالى: ﴿الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نوم﴾" },
    expect: (r) => r.claims?.[0]?.verdict === "quran_match" && r.status === "supported",
    want: "quran_match + مؤيَّد",
  },
  {
    name: "آية محرّفة",
    path: "/v1/verify",
    body: { text: "قال تعالى: ﴿الله لا إله إلا هو الحي القيوم لا تأخذه سنة ولا نعاس﴾" },
    expect: (r) => r.claims?.[0]?.verdict === "quran_mismatch" && r.status === "needs_review",
    want: "quran_mismatch + يحتاج تحقق",
  },
  {
    name: "حديث لا يثبت",
    path: "/v1/verify",
    body: { text: "قال رسول الله ﷺ: اطلبوا العلم ولو في الصين" },
    expect: (r) => ["fabricated", "weak"].includes(r.claims?.[0]?.verdict),
    want: "fabricated أو weak",
  },
  {
    name: "حالة شخصية",
    path: "/v1/ask",
    body: { question: "أنا أعيش في دولة أوروبية، هل يجوز لي أن أتزوج بدون ولي؟" },
    expect: (r) => r.status === "referral",
    want: "إحالة للمختص",
  },
];

let passed = 0;
for (const c of cases) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL_}${c.path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(c.body),
      signal: AbortSignal.timeout(90_000),
    });
    const r = await res.json();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`❌ ${c.name}: HTTP ${res.status} — ${r?.error?.message ?? JSON.stringify(r).slice(0, 200)}`);
      continue;
    }
    const got = `${r.claims?.[0]?.verdict ?? "-"} / ${r.status_label ?? r.status}`;
    if (c.expect(r)) {
      passed++;
      console.log(`✅ ${c.name} (${secs}s): ${got}`);
    } else {
      console.log(`❌ ${c.name} (${secs}s): طلع ${got} — المتوقع ${c.want}`);
      console.log(`   ${String(r.answer ?? "").slice(0, 300).replace(/\n/g, " ")}`);
    }
  } catch (e) {
    console.log(`❌ ${c.name}: ${String(e).slice(0, 200)}`);
  }
}
console.log(`\n${passed}/${cases.length} نجحت`);

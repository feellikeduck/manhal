// يفحص ملف .env بدون ما يطبع أي مفتاح أو كلمة سر
// التشغيل (من مجلد manhal):  deno run -A --env-file=.env scripts/check-env.ts
import postgres from "npm:postgres@3";

const ok = (m: string) => console.log(`✅ ${m}`);
const bad = (m: string) => console.log(`❌ ${m}`);
let failed = false;

// ── 1) رابط القاعدة ──
const db = Deno.env.get("DATABASE_URL")?.trim() ?? "";
if (!db) {
  bad("DATABASE_URL فاضي أو مو موجود في .env");
  failed = true;
} else if (!/^postgres(ql)?:\/\//.test(db)) {
  bad("DATABASE_URL لازم يبدأ بـ postgresql://  (لا تحط علامات تنصيص ولا مسافات)");
  failed = true;
} else if (/YOUR-PASSWORD|\[|\]/.test(db)) {
  bad("DATABASE_URL فيه [YOUR-PASSWORD] أو أقواس — بدّلها بكلمة السر الجديدة بدون الأقواس");
  failed = true;
} else {
  try {
    const sql = postgres(db, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
    const [r] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
    await sql.end();
    r.n >= 9 ? ok(`الاتصال بـ Supabase شغّال (${r.n} جداول)`) : bad(`اتصل بس الجداول ${r.n} (المتوقع 9) — تأكد إنه مشروع manhal`);
    if (r.n < 9) failed = true;
  } catch (e) {
    const msg = String(e);
    if (/password/i.test(msg)) bad("كلمة سر القاعدة غلط — سوّ Reset مرة ثانية وانسخها بدقة");
    else if (/ENOTFOUND|getaddrinfo/i.test(msg)) bad("عنوان القاعدة غلط — انسخ رابط Session pooler من زر Connect");
    else bad(`ما قدر يتصل بالقاعدة: ${msg.slice(0, 120)}`);
    failed = true;
  }
}

// ── 2) مفتاح OpenAI ──
const key = Deno.env.get("OPENAI_API_KEY")?.trim() ?? "";
const model = Deno.env.get("MANHAL_MODEL_GENERATE") ?? "gpt-6-astra";
if (!key) {
  bad("OPENAI_API_KEY فاضي أو مو موجود في .env");
  failed = true;
} else if (!key.startsWith("sk-")) {
  bad("OPENAI_API_KEY لازم يبدأ بـ sk-");
  failed = true;
} else {
  const r = await fetch(`https://api.openai.com/v1/models/${model}`, { headers: { Authorization: `Bearer ${key}` } });
  if (r.status === 200) ok(`مفتاح OpenAI شغّال، والمودل ${model} متاح لحسابك`);
  else if (r.status === 401) {
    bad("مفتاح OpenAI غلط أو انحذف");
    failed = true;
  } else if (r.status === 404) {
    bad(`المفتاح شغّال، بس المودل ${model} مو متاح لحسابك`);
    failed = true;
  } else {
    bad(`OpenAI رجّع ${r.status} — تأكد إن فيه رصيد في Billing`);
    failed = true;
  }
}

console.log(failed ? "\nصلّح اللي عليه ❌ وشغّل الفحص مرة ثانية." : "\nكل شي تمام 👌 كمّل لاستيراد القرآن.");

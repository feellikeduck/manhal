// اختبار منهل مقابل نفس المودل بدون منهل. ينتج CSV يراجعه المتخصص الشرعي.
// deno task eval                      (eval/cases.json، 3 مرات لكل حالة)
// deno task eval --cases eval/cases.example.json --runs 1
import { opt } from "./_args.ts";

const API = Deno.env.get("MANHAL_API_URL");
const KEY = Deno.env.get("MANHAL_TEST_KEY");
const OPENAI = Deno.env.get("OPENAI_API_KEY");
const BASE = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
const MODEL = Deno.env.get("MANHAL_MODEL_GENERATE") ?? "gpt-6-astra";
if (!API || !KEY || !OPENAI) throw new Error("set MANHAL_API_URL, MANHAL_TEST_KEY, OPENAI_API_KEY");

type Case = { id: string; type: "ask" | "verify" | "translate"; input: Record<string, string>; expected?: string };
const cases: Case[] = JSON.parse(await Deno.readTextFile(opt("cases", "eval/cases.json")!));
const RUNS = Number(opt("runs", "3"));

// نفس السؤال للمودل الخام، بدون مصادر ولا قيود
function rawPrompt(c: Case): string {
  if (c.type === "ask") return c.input.question;
  if (c.type === "verify") return `هل هذا صحيح؟ تحقق منه:\n${c.input.text}`;
  return `Translate into ${c.input.target_lang}:\n${c.input.text}`;
}

async function raw(c: Case): Promise<string> {
  const r = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: rawPrompt(c) }] }),
  });
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    return j.choices?.[0]?.message?.content ?? text;
  } catch {
    return `ERROR ${r.status}: ${text.slice(0, 200)}`;
  }
}

async function manhal(c: Case) {
  const r = await fetch(`${API}/v1/${c.type}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(c.input),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: `${r.status}: ${text.slice(0, 200)}` } };
  }
}

const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
const header = [
  "case_id",
  "type",
  "run",
  "input",
  "expected",
  "raw_output",
  "manhal_output",
  "manhal_status",
  "manhal_sources",
  // أعمدة المراجع (يعبّيها المتخصص: 1 صح / 0 خطأ)
  "raw_terms",
  "manhal_terms",
  "raw_attribution",
  "manhal_attribution",
  "raw_abstention",
  "manhal_abstention",
  "notes",
];
const lines = [header.join(",")];

for (const c of cases) {
  for (let run = 1; run <= RUNS; run++) {
    const [r, m] = await Promise.all([raw(c), manhal(c)]);
    const res = m.error ? { answer: `ERROR: ${m.error.message}`, status: "error", sources: [] } : m;
    lines.push(
      [
        c.id,
        c.type,
        run,
        JSON.stringify(c.input),
        c.expected,
        r,
        res.answer,
        res.status,
        (res.sources ?? []).map((s: { title: string }) => s.title).join(" | "),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ].map(esc).join(","),
    );
    console.log(`${c.id} #${run}: manhal=${res.status}`);
  }
}
await Deno.mkdir("eval", { recursive: true });
const out = `eval/results-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
await Deno.writeTextFile(out, "\uFEFF" + lines.join("\n"));
console.log(`\n✓ ${out} — ${lines.length - 1} rows. أرسله للمتخصص يعبّي الأعمدة الأخيرة.`);

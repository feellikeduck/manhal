import { config } from "./config.ts";
import { HttpError } from "./types.ts";

async function call(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${config.openaiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`openai ${path} ${res.status}: ${detail.slice(0, 500)}`);
    throw new HttpError(502, "Upstream model error", "upstream_error");
  }
  return res.json();
}

function parseJSON<T>(text: string): T {
  const clean = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as T;
    throw new HttpError(502, "Model returned invalid JSON", "upstream_error");
  }
}

/** طلب يرجع JSON فقط */
export async function chatJSON<T>(model: string, system: string, user: unknown): Promise<T> {
  const data = await call("/chat/completions", {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: typeof user === "string" ? user : JSON.stringify(user) },
    ],
    response_format: { type: "json_object" },
  });
  return parseJSON<T>(data.choices?.[0]?.message?.content ?? "");
}

export async function embed(texts: string[]): Promise<number[][]> {
  const data = await call("/embeddings", { model: config.modelEmbed, input: texts });
  return data.data.sort((a: any, b: any) => a.index - b.index).map((d: any) => d.embedding);
}

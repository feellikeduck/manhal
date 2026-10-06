import type { Capability, ManhalResult } from "./types.ts";
import { HttpError } from "./types.ts";

/** أسماء "المودلات" في صيغة OpenAI — كل اسم قدرة من قدرات منهل */
export const MODELS: Record<string, Capability> = {
  "manhal": "ask",
  "manhal-ask": "ask",
  "manhal-translate": "translate",
  "manhal-verify": "verify",
  "manhal-guard": "guard",
  "manhal-generate": "generate",
};

type Msg = { role: string; content: unknown };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p: any) => (p?.type === "text" ? p.text : "")).join("\n");
  }
  return "";
}

/** يحوّل طلب chat/completions إلى مدخلات قدرة من قدرات منهل */
export function fromChatRequest(body: any): { capability: Capability; input: Record<string, unknown> } {
  const model = String(body?.model ?? "manhal");
  const capability = MODELS[model];
  if (!capability) {
    throw new HttpError(404, `Unknown model '${model}'. Use one of: ${Object.keys(MODELS).join(", ")}`, "model_not_found");
  }
  const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length) throw new HttpError(400, "'messages' is required");
  const lang = body.lang ?? body.metadata?.lang;
  const lastIndex = (role: string, before = messages.length) => {
    for (let i = before - 1; i >= 0; i--) if (messages[i].role === role) return i;
    return -1;
  };
  const u = lastIndex("user");
  const lastUser = u >= 0 ? textOf(messages[u].content) : "";

  switch (capability) {
    case "ask":
      return { capability, input: { question: lastUser, lang } };
    case "verify":
      return { capability, input: { text: lastUser, lang } };
    case "generate":
      return { capability, input: { topic: lastUser, lang } };
    case "translate":
      return { capability, input: { text: lastUser, target_lang: body.target_lang ?? body.metadata?.target_lang ?? "en" } };
    case "guard": {
      // أرسل المحادثة كما هي: منهل يراجع آخر جواب من نموذجك
      const a = lastIndex("assistant");
      const q = lastIndex("user", a);
      if (a < 0 || q < 0) throw new HttpError(400, "manhal-guard needs a user message followed by the assistant answer to check");
      return { capability, input: { question: textOf(messages[q].content), answer: textOf(messages[a].content), lang } };
    }
  }
}

export function toChatCompletion(result: ManhalResult, model: string) {
  return {
    id: `chatcmpl-${result.id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: result.answer }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    manhal: result,
  };
}

/** stream: true — نرسل الجواب كاملاً في مقطع واحد بصيغة SSE */
export function toChatStream(result: ManhalResult, model: string, headers: Record<string, string>): Response {
  const base = { id: `chatcmpl-${result.id}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model };
  const events = [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", content: result.answer }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], manhal: result },
  ];
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export function listModels() {
  return {
    object: "list",
    data: Object.keys(MODELS).map((id) => ({ id, object: "model", created: 0, owned_by: "manhal" })),
  };
}

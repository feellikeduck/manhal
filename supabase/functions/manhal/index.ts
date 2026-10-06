// منهل — The trust layer for Islamic AI
// Supabase Edge Function. انشره بـ: supabase functions deploy manhal --no-verify-jwt
import { ask, generate, guard, translate, verify } from "./lib/capabilities.ts";
import { logRequest } from "./lib/db.ts";
import { authenticate, corsHeaders, errorResponse, json, routeOf } from "./lib/http.ts";
import { fromChatRequest, listModels, toChatCompletion, toChatStream } from "./lib/openai-compat.ts";
import type { Capability, ManhalResult } from "./lib/types.ts";
import { HttpError } from "./lib/types.ts";

const RUN: Record<Capability, (input: any) => Promise<Omit<ManhalResult, "id" | "capability">>> = {
  ask,
  translate,
  verify,
  guard,
  generate,
};

const ROUTES: Record<string, Capability> = {
  "/v1/ask": "ask",
  "/v1/translate": "translate",
  "/v1/verify": "verify",
  "/v1/guard": "guard",
  "/v1/generate": "generate",
};

async function readJSON(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  const started = Date.now();
  const route = routeOf(new URL(req.url));
  let keyId: string | null = null;
  let body: any = null;

  try {
    if (req.method === "GET" && (route === "/" || route === "/v1/health")) {
      return json(req, { name: "Manhal", tagline: "The trust layer for Islamic AI", ok: true });
    }

    const key = await authenticate(req);
    keyId = key.id;

    if (req.method === "GET" && route === "/v1/models") return json(req, listModels());
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    body = await readJSON(req);
    const chat = route === "/v1/chat/completions";
    const { capability, input } = chat ? fromChatRequest(body) : { capability: ROUTES[route], input: body };
    if (!capability) throw new HttpError(404, `Unknown endpoint '${route}'`, "not_found");

    const id = crypto.randomUUID();
    const result: ManhalResult = { id, capability, ...(await RUN[capability](input)) };

    // الخصوصية: الحالات الشخصية (المستوى د) لا يُحفظ نصها، فقط الحالة والمستوى
    const personal = result.level === "D";
    await logRequest({
      id,
      key_id: keyId,
      endpoint: chat ? `chat:${capability}` : capability,
      status: result.status,
      latency_ms: Date.now() - started,
      request: personal ? { redacted: "personal case (level D)" } : body,
      response: personal ? { status: result.status, level: result.level } : result,
    });

    if (!chat) return json(req, result);
    const model = String(body.model ?? "manhal");
    return body.stream ? toChatStream(result, model, corsHeaders(req)) : json(req, toChatCompletion(result, model));
  } catch (e) {
    if (keyId && !(e instanceof HttpError && e.status < 500)) {
      await logRequest({
        id: crypto.randomUUID(),
        key_id: keyId,
        endpoint: route,
        status: "error",
        latency_ms: Date.now() - started,
        // الخطأ قد يقع قبل التصنيف، فما نعرف هل هي حالة شخصية: ما نحفظ نص الطلب
        request: { redacted: "request text not stored on error", chars: body ? JSON.stringify(body).length : 0 },
        response: { error: String(e) },
      });
    }
    return errorResponse(req, e);
  }
});

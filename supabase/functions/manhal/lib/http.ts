import { countToday, findKey, type KeyRow } from "./db.ts";
import { HttpError } from "./types.ts";

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "authorization, content-type, x-manhal-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

/** نفس شكل أخطاء OpenAI، عشان مكتباتهم تفهمها */
export function errorResponse(req: Request, e: unknown): Response {
  if (e instanceof HttpError) {
    return json(req, { error: { message: e.message, type: e.code, code: e.code } }, e.status);
  }
  console.error(e);
  return json(req, { error: { message: "Internal error", type: "server_error", code: "server_error" } }, 500);
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function domainAllowed(origin: string | null, allowed: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return allowed.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * مفتاحان:
 * - mh_sk_… سري للمطورين (من الخادم فقط)
 * - mh_pk_… عام للقوالب ومنهل تشات، يشتغل فقط من الدومينات المسموحة
 */
export async function authenticate(req: Request): Promise<KeyRow> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim() || req.headers.get("x-manhal-key")?.trim() || "";
  if (!/^mh_(sk|pk)_[a-f0-9]{32,}$/.test(token)) throw new HttpError(401, "Missing or invalid API key", "invalid_api_key");

  const key = await findKey(await sha256(token));
  if (!key || !key.active) throw new HttpError(401, "Invalid API key", "invalid_api_key");
  if (key.kind === "public" && !domainAllowed(req.headers.get("origin"), key.allowed_domains)) {
    throw new HttpError(403, "This public key is not allowed on this domain", "domain_not_allowed");
  }
  if ((await countToday(key.id)) >= key.daily_limit) {
    throw new HttpError(429, "Daily limit reached for this key", "rate_limit_exceeded");
  }
  return key;
}

/** يشيل بادئة Supabase: /functions/v1/manhal/v1/ask ← /v1/ask */
export function routeOf(url: URL): string {
  const p = url.pathname.replace(/\/+$/, "");
  const i = p.indexOf("/manhal");
  return (i >= 0 ? p.slice(i + "/manhal".length) : p) || "/";
}

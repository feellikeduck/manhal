// ينشئ مفتاح API. المفتاح يظهر مرة وحدة فقط، والقاعدة تحفظ بصمته (hash).
// deno task key --owner "ترجمان الخطبة" --kind secret
// deno task key --owner "قالب تعريف بالإسلام" --kind public --domains example.com,localhost --limit 5000
import { opt, sql } from "./_db.ts";
import { sha256 } from "../supabase/functions/manhal/lib/http.ts";

const kind = opt("kind", "secret") as "secret" | "public";
const owner = opt("owner");
if (!owner || !["secret", "public"].includes(kind)) {
  console.error('usage: --owner "<name>" --kind secret|public [--domains a.com,b.com] [--limit 1000]');
  Deno.exit(1);
}
const domains = (opt("domains") ?? "").split(",").map((d) => d.trim()).filter(Boolean);
if (kind === "public" && !domains.length) {
  console.error("public keys need --domains");
  Deno.exit(1);
}
const rand = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
const key = `mh_${kind === "secret" ? "sk" : "pk"}_${rand}`;
await sql`insert into api_keys ${
  sql({ key_hash: await sha256(key), kind, owner, allowed_domains: domains, daily_limit: Number(opt("limit", "1000")) })
}`;
console.log(`\n${kind} key for "${owner}":\n\n  ${key}\n\nاحفظه الحين — ما يظهر مرة ثانية.\n`);
await sql.end();

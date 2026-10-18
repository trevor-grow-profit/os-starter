// Creates the first (owner) user and prints a one-use link to register their passkey.
//   Local:      node tools/bootstrap-owner.mjs you@example.com
//   Production: node tools/bootstrap-owner.mjs you@example.com --remote --origin https://os.yourdomain.com
// Refuses to run once any user exists, so it can't be used to take over a live OS.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const email = (args.find(a => !a.startsWith("--") && a.includes("@")) || "").trim().toLowerCase();
const remote = args.includes("--remote");
const originAt = args.indexOf("--origin");
const origin = originAt >= 0 && args[originAt + 1] ? args[originAt + 1].replace(/\/$/, "") : "http://localhost:8787";
const db = process.env.OS_DB || "os-starter";
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: node tools/bootstrap-owner.mjs you@example.com [--remote --origin https://os.yourdomain.com]");
  process.exit(1);
}

const q = (v) => "'" + v.replaceAll("'", "''") + "'";
function sql(command) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", db, remote ? "--remote" : "--local", "--json", "--command", command], { encoding: "utf8" });
  return JSON.parse(out)[0].results || [];
}

if (sql("SELECT count(*) AS n FROM users")[0].n !== 0) {
  console.error("A user already exists. Bootstrap only runs on an empty OS.");
  process.exit(1);
}
const id = randomUUID();
const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("base64url");
const created = new Date().toISOString();
const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
sql(`INSERT INTO users(id,email,owner,active,created_at) VALUES (${q(id)},${q(email)},1,1,${q(created)});
  INSERT INTO setup_tokens(token_hash,user_id,expires_at) VALUES (${q(tokenHash)},${q(id)},${q(expiry)});`);
console.log(`Owner created. Open this link within 24 hours to set up your passkey (it works once):\n${origin}/#setup=${encodeURIComponent(token)}`);

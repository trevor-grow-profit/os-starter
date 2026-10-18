// Passkey sign-in. Sessions live in D1; the browser only holds a random token in an HttpOnly cookie.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

const COOKIE = "__Host-os_session";
const FIVE_MINUTES = 5 * 60 * 1000;
const SESSION_LIFE = 30 * 24 * 60 * 60 * 1000;

export const json = (body, status = 200, extra = {}) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
});
const bytesToB64 = (data) => btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64ToBytes = (data) => Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const randomToken = () => bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async (value) => bytesToB64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const now = () => new Date().toISOString();
const expires = (ms) => new Date(Date.now() + ms).toISOString();
const readCookie = (request) => (request.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) || "";
const body = async (request) => request.json().catch(() => ({}));

// The address people use to reach the OS. Passkeys are bound to it, so it must stay the same once set.
export function site(request, env) {
  const origin = env.APP_ORIGIN || new URL(request.url).origin;
  return { origin, rpID: new URL(origin).hostname, name: env.APP_NAME || "My OS" };
}

function challengeOf(credential) {
  try { return JSON.parse(new TextDecoder().decode(b64ToBytes(credential.response.clientDataJSON))).challenge; }
  catch { return ""; }
}

// 30 sign-in attempts per IP per 15 minutes.
async function underLimit(env, request) {
  const bucket = await hash(request.headers.get("CF-Connecting-IP") || "local");
  const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO auth_attempts(source,count,window_start) VALUES (?,1,?)
    ON CONFLICT(source) DO UPDATE SET count=CASE WHEN window_start>? THEN count+1 ELSE 1 END,
    window_start=CASE WHEN window_start>? THEN window_start ELSE excluded.window_start END`)
    .bind(bucket, now(), windowStart, windowStart).run();
  const row = await env.DB.prepare("SELECT count FROM auth_attempts WHERE source=?").bind(bucket).first();
  return row.count <= 30;
}

export async function currentUser(request, env) {
  const token = readCookie(request);
  if (!token || !env.DB) return null;
  return await env.DB.prepare(`SELECT users.id,users.email,users.owner FROM sessions
    JOIN users ON users.id=sessions.user_id
    WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.active=1`)
    .bind(await hash(token), now()).first() || null;
}

async function sessionCookie(env, userId) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(await hash(token), userId, expires(SESSION_LIFE)).run();
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFE / 1000}`;
}

async function registrationOptions(env, s, user) {
  const keys = await env.DB.prepare("SELECT id,transports FROM passkeys WHERE user_id=?").bind(user.id).all();
  return generateRegistrationOptions({
    rpName: s.name, rpID: s.rpID, userID: new TextEncoder().encode(user.id), userName: user.email,
    attestationType: "none", supportedAlgorithmIDs: [-7, -257],
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: keys.results.map(k => ({ id: k.id, transports: JSON.parse(k.transports) })),
  });
}

async function savePasskey(env, userId, info) {
  await env.DB.prepare("INSERT INTO passkeys(id,user_id,public_key,counter,transports,created_at) VALUES (?,?,?,?,?,?)")
    .bind(info.credential.id, userId, Array.from(info.credential.publicKey), info.credential.counter,
      JSON.stringify(info.credential.transports || []), now()).run();
}

async function signInOptions(env, s) {
  const options = await generateAuthenticationOptions({ rpID: s.rpID, userVerification: "required" });
  await env.DB.prepare("INSERT INTO challenges(challenge,ceremony,expires_at) VALUES (?,'authentication',?)")
    .bind(options.challenge, expires(FIVE_MINUTES)).run();
  return json(options);
}

async function signInVerify(env, s, request) {
  const reject = () => json({ error: "Passkey not accepted." }, 401);
  const credential = await body(request);
  const used = await env.DB.prepare("DELETE FROM challenges WHERE challenge=? AND ceremony='authentication' AND expires_at>? RETURNING challenge")
    .bind(challengeOf(credential), now()).first();
  if (!used) return reject();
  const key = await env.DB.prepare("SELECT passkeys.*, users.active FROM passkeys JOIN users ON users.id=passkeys.user_id WHERE passkeys.id=?")
    .bind(String(credential.id || "")).first();
  if (!key || !key.active) return reject();
  try {
    const result = await verifyAuthenticationResponse({
      response: credential, expectedChallenge: used.challenge, expectedOrigin: s.origin, expectedRPID: s.rpID,
      requireUserVerification: true,
      credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) },
    });
    if (!result.verified) return reject();
    await env.DB.prepare("UPDATE passkeys SET counter=?,last_used_at=? WHERE id=?")
      .bind(result.authenticationInfo.newCounter, now(), key.id).run();
    return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, key.user_id) });
  } catch { return reject(); }
}

async function setupUser(env, token) {
  if (typeof token !== "string" || token.length < 40) return null;
  const tokenHash = await hash(token);
  const user = await env.DB.prepare(`SELECT users.id,users.email FROM setup_tokens JOIN users ON users.id=setup_tokens.user_id
    WHERE token_hash=? AND expires_at>? AND users.active=1`).bind(tokenHash, now()).first();
  return user ? { ...user, tokenHash } : null;
}

async function setupOptions(env, s, request) {
  const user = await setupUser(env, (await body(request)).token);
  if (!user) return json({ error: "Setup link invalid or expired." }, 401);
  const options = await registrationOptions(env, s, user);
  await env.DB.prepare("INSERT INTO challenges(challenge,ceremony,user_id,setup_hash,expires_at) VALUES (?,'registration',?,?,?)")
    .bind(options.challenge, user.id, user.tokenHash, expires(FIVE_MINUTES)).run();
  return json(options);
}

async function setupVerify(env, s, request) {
  const { token, credential } = await body(request);
  const user = await setupUser(env, token);
  if (!user || !credential?.id) return json({ error: "Setup failed." }, 401);
  const used = await env.DB.prepare(`DELETE FROM challenges WHERE challenge=? AND ceremony='registration'
    AND setup_hash=? AND expires_at>? RETURNING challenge`).bind(challengeOf(credential), user.tokenHash, now()).first();
  if (!used) return json({ error: "Setup failed." }, 401);
  try {
    const result = await verifyRegistrationResponse({
      response: credential, expectedChallenge: used.challenge, expectedOrigin: s.origin, expectedRPID: s.rpID,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo) return json({ error: "Setup failed." }, 401);
    await env.DB.prepare("DELETE FROM setup_tokens WHERE token_hash=?").bind(user.tokenHash).run();
    await savePasskey(env, user.id, result.registrationInfo);
    return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, user.id) });
  } catch { return json({ error: "Setup failed." }, 401); }
}

// Signed-in users managing their own passkeys (Settings tab).
async function passkeys(env, s, request, path, user) {
  if (path === "/api/auth/passkeys" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,created_at,last_used_at FROM passkeys WHERE user_id=? ORDER BY created_at").bind(user.id).all();
    return json({ passkeys: rows.results });
  }
  if (path === "/api/auth/passkeys/options") {
    const options = await registrationOptions(env, s, user);
    await env.DB.prepare("INSERT INTO challenges(challenge,ceremony,user_id,expires_at) VALUES (?,'registration',?,?)")
      .bind(options.challenge, user.id, expires(FIVE_MINUTES)).run();
    return json(options);
  }
  if (path === "/api/auth/passkeys/register") {
    const credential = await body(request);
    const used = await env.DB.prepare(`DELETE FROM challenges WHERE challenge=? AND ceremony='registration'
      AND user_id=? AND setup_hash IS NULL AND expires_at>? RETURNING challenge`).bind(challengeOf(credential), user.id, now()).first();
    if (!used) return json({ error: "Passkey not accepted." }, 401);
    try {
      const result = await verifyRegistrationResponse({
        response: credential, expectedChallenge: used.challenge, expectedOrigin: s.origin, expectedRPID: s.rpID,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo) return json({ error: "Passkey not accepted." }, 401);
      await savePasskey(env, user.id, result.registrationInfo);
      return json({ ok: true });
    } catch { return json({ error: "Passkey not accepted." }, 401); }
  }
  if (path === "/api/auth/passkeys/delete") {
    const { id } = await body(request);
    const changed = await env.DB.prepare(`DELETE FROM passkeys WHERE id=? AND user_id=?
      AND (SELECT COUNT(*) FROM passkeys WHERE user_id=?)>1`).bind(String(id || ""), user.id, user.id).run();
    return changed.meta.changes ? json({ ok: true }) : json({ error: "Keep at least one passkey." }, 409);
  }
  return json({ error: "Not found." }, 404);
}

export async function authRoute(request, env, path) {
  const s = site(request, env);
  if (request.method === "POST" && request.headers.get("Origin") !== s.origin) return json({ error: "Invalid origin." }, 403);
  const open = ["/api/auth/options", "/api/auth/verify", "/api/auth/setup/options", "/api/auth/setup/verify"];
  if (open.includes(path)) {
    if (request.method !== "POST") return json({ error: "Not found." }, 404);
    if (!await underLimit(env, request)) return json({ error: "Too many attempts. Try again later." }, 429);
    if (path === "/api/auth/options") return signInOptions(env, s);
    if (path === "/api/auth/verify") return signInVerify(env, s, request);
    if (path === "/api/auth/setup/options") return setupOptions(env, s, request);
    return setupVerify(env, s, request);
  }
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in required." }, 401);
  if (path === "/api/auth/me") return json({ email: user.email, owner: !!user.owner, appName: s.name });
  if (path === "/api/auth/logout" && request.method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hash(readCookie(request))).run();
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` });
  }
  if (path.startsWith("/api/auth/passkeys")) return passkeys(env, s, request, path, user);
  return json({ error: "Not found." }, 404);
}

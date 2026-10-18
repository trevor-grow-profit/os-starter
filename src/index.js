// The OS Worker: sign-in gate, API routes, and the app shell. Everything in /public is served only after sign-in.
import { authRoute, currentUser, json, site } from "./auth.js";
import { listConnections, testConnection, airtableRecords } from "./connectors.js";
import { tasksRoute } from "./tasks.js";

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const loginPage = (name, nonce) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0f1216"><title>Sign in | ${name}</title>
<style>html{font-family:system-ui,sans-serif;background:#0f1216;color:#dce3ea}body{margin:0;min-height:100dvh;display:grid;place-items:center}main{box-sizing:border-box;width:min(100%,28rem);padding:2rem}h1{font-size:1.5rem}p{line-height:1.5;color:#9aa7b4}button{font:inherit;background:#3b82f6;border:0;color:#fff;padding:.8rem 1.2rem;border-radius:.5rem;cursor:pointer}button:disabled{opacity:.5;cursor:wait}</style></head>
<body><main><h1>${name}</h1><p id="help">Sign in with your passkey.</p><button id="go" disabled>Preparing passkey...</button><p id="error" role="alert"></p></main>
<script nonce="${nonce}">
const enc=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const dec=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
const go=document.getElementById('go'),error=document.getElementById('error'),help=document.getElementById('help');
let setup='',options=null;
if(location.hash.startsWith('#setup=')){setup=decodeURIComponent(location.hash.slice(7));history.replaceState(null,'',location.pathname);help.textContent='Set up your passkey. This link works once.';}
async function post(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d;}
async function prime(){try{options=await post(setup?'/api/auth/setup/options':'/api/auth/options',setup?{token:setup}:{});go.disabled=false;go.textContent=setup?'Set up passkey':'Sign in with passkey';}catch(e){error.textContent=e.message;go.textContent='Unavailable';}}
if(window.PublicKeyCredential&&window.isSecureContext)prime();else error.textContent='Open this page over https (or localhost) in a browser that supports passkeys.';
go.onclick=async()=>{if(!options)return;const saved=options;options=null;go.disabled=true;error.textContent='';try{
  if(setup){const o={...saved,challenge:dec(saved.challenge),user:{...saved.user,id:dec(saved.user.id)},excludeCredentials:(saved.excludeCredentials||[]).map(x=>({...x,id:dec(x.id)}))};const c=await navigator.credentials.create({publicKey:o});
    await post('/api/auth/setup/verify',{token:setup,credential:{id:c.id,rawId:enc(c.rawId),type:c.type,response:{clientDataJSON:enc(c.response.clientDataJSON),attestationObject:enc(c.response.attestationObject),transports:c.response.getTransports?.()||[]},clientExtensionResults:c.getClientExtensionResults()}});
  }else{const o={...saved,challenge:dec(saved.challenge),allowCredentials:(saved.allowCredentials||[]).map(x=>({...x,id:dec(x.id)}))};const c=await navigator.credentials.get({publicKey:o});
    await post('/api/auth/verify',{id:c.id,rawId:enc(c.rawId),type:c.type,response:{clientDataJSON:enc(c.response.clientDataJSON),authenticatorData:enc(c.response.authenticatorData),signature:enc(c.response.signature),userHandle:c.response.userHandle?enc(c.response.userHandle):null},clientExtensionResults:c.getClientExtensionResults()});
  }
  location.replace('/');
}catch(e){error.textContent=e.name==='NotAllowedError'?'Passkey cancelled or unavailable.':e.message;prime();}};
</script></body></html>`;

function loginResponse(name) {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  return new Response(loginPage(escape(name), nonce), { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`,
  } });
}

// Signed-in API. Add your own routes here.
async function apiRoute(request, env, path, user) {
  if (request.method !== "GET" && request.headers.get("Origin") !== site(request, env).origin) return json({ error: "Invalid origin." }, 403);
  if (path === "/api/tasks") return tasksRoute(request, env, user);
  if (path === "/api/connections" && request.method === "GET") return listConnections(env);
  if (path === "/api/connections/test" && request.method === "POST") {
    const { key } = await request.json().catch(() => ({}));
    return testConnection(env, String(key || ""));
  }
  if (path === "/api/airtable/records" && request.method === "GET") return airtableRecords(env);
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!env.DB) return new Response("Database not bound. See README step 3.", { status: 503 });
    try {
      if (path.startsWith("/api/auth/")) return await authRoute(request, env, path);
      const user = await currentUser(request, env);
      if (path.startsWith("/api/")) return user ? await apiRoute(request, env, path, user) : json({ error: "Sign in required." }, 401);
      if (!user) return path === "/" ? loginResponse(site(request, env).name) : Response.redirect(new URL("/", url), 302);
      const asset = await env.ASSETS.fetch(request);
      const headers = new Headers(asset.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("X-Frame-Options", "DENY");
      headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
      return new Response(asset.body, { status: asset.status, headers });
    } catch (error) {
      console.error(error);
      return json({ error: "Something went wrong." }, 500);
    }
  },
};

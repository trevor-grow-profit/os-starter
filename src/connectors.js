// Every outside tool the OS talks to is listed here. Keys stay on the server as Worker secrets;
// the browser only ever sees "connected" or "not connected" and whatever data a route chooses to return.
//
// To add a tool: add an entry below, set its secret with `wrangler secret put NAME`,
// then add a route in apiRoute() that calls it. See README "Connect your own tools".
import { json } from "./auth.js";

export const connectors = {
  airtable: {
    label: "Airtable",
    use: "Database / source of truth",
    secrets: ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "AIRTABLE_TABLE"],
    test: (env) => fetch("https://api.airtable.com/v0/meta/whoami", { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } }),
  },
  stripe: {
    label: "Stripe",
    use: "Payments",
    secrets: ["STRIPE_SECRET_KEY"],
    test: (env) => fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }),
  },
  ghl: {
    label: "GoHighLevel",
    use: "CRM and automations",
    secrets: ["GHL_API_KEY", "GHL_LOCATION_ID"],
    test: (env) => fetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(env.GHL_LOCATION_ID)}`, {
      headers: { Authorization: `Bearer ${env.GHL_API_KEY}`, Version: "2021-07-28", Accept: "application/json" },
    }),
  },
  slack: {
    label: "Slack",
    use: "Automated alerts",
    secrets: ["SLACK_WEBHOOK_URL"],
    test: (env) => fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Test alert from your OS. The connection works." }),
    }),
  },
};

const configured = (env, c) => c.secrets.every(name => !!env[name]);

export function listConnections(env) {
  return json({
    connections: Object.entries(connectors).map(([key, c]) => ({
      key, label: c.label, use: c.use, secrets: c.secrets, connected: configured(env, c),
    })),
  });
}

export async function testConnection(env, key) {
  const c = connectors[key];
  if (!c) return json({ error: "Unknown connection." }, 404);
  if (!configured(env, c)) return json({ ok: false, message: `Missing: ${c.secrets.filter(n => !env[n]).join(", ")}` });
  try {
    const res = await c.test(env);
    return json({ ok: res.ok, message: res.ok ? "Connected" : `The tool answered ${res.status}. Check the key and its permissions.` });
  } catch {
    return json({ ok: false, message: "Could not reach the tool." });
  }
}

// Worked example: read the first 50 rows of one Airtable table for the Home tab.
// Copy this shape for any tool: call the API with the secret, return only what the page needs.
export async function airtableRecords(env) {
  if (!configured(env, connectors.airtable)) return json({ connected: false, records: [] });
  const url = `https://api.airtable.com/v0/${encodeURIComponent(env.AIRTABLE_BASE_ID)}/${encodeURIComponent(env.AIRTABLE_TABLE)}?pageSize=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
  if (!res.ok) return json({ connected: true, error: `Airtable answered ${res.status}`, records: [] }, 502);
  const data = await res.json();
  return json({ connected: true, records: data.records.map(r => ({ id: r.id, ...r.fields })) });
}

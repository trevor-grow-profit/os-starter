# OS Starter

The starter version of the operating system I run my business from.

It's one private web app where your whole business lives: your numbers, your tasks, your CRM, your payments, your alerts. You sign in with Face ID or Touch ID, and every tool you use plugs into it. No more 14 tabs.

This repo is the frame. It has no data and no connections in it. You bring your own tools and wire them in. The steps below show you how.

**What you get out of the box**

- A sign-in page that uses passkeys (Face ID, Touch ID, Windows Hello). No passwords to leak.
- A tabbed app shell that works on desktop and phone.
- A database (Cloudflare D1) with a working example tab (Tasks).
- A Connections tab with Airtable, Stripe, GoHighLevel and Slack already set up. Add your keys and they light up.
- A worked example of pulling live data from a tool (Airtable rows on the Home tab).

It runs on Cloudflare's free tier. Most people will pay $0 a month for this.

---

## The stack

### What you need (required)

| Piece | What it does | Cost |
|---|---|---|
| [Cloudflare account](https://dash.cloudflare.com/sign-up) | Hosts the app (a Worker) and the database (D1) | Free tier is plenty |
| [Node.js](https://nodejs.org) 20 or newer | Runs the setup commands on your computer | Free |
| Wrangler (Cloudflare's CLI) | Deploys the app and manages the database. Installed by `npm install` | Free |
| A GitHub account | To copy this repo and keep your changes | Free |

That's it. Everything else is optional.

### What I run on top of it (my stack)

This is what my own OS connects to. You don't need any of it. It's here so you can see how the pieces fit.

| Job | Tool I use | How it connects |
|---|---|---|
| App + backend | Cloudflare Workers + D1 | This repo |
| Source of truth for business data | Airtable | API token, read by a Worker route |
| CRM, funnels, follow-up automations | GoHighLevel | API key + webhooks |
| Payments | Stripe | Restricted API key |
| Webhooks from other tools | Cloudflare Workers | A route that receives the webhook and writes to D1 |
| Scheduled jobs (nightly syncs, reports) | GitHub Actions | A workflow on a cron that calls the OS or the tool APIs |
| Automated alerts | Slack | Incoming webhook URL |
| Team chat (humans) | Telegram | Not connected to the OS |

The rule I follow: **one source of truth, everything else reads from it.** Don't store the same customer in three places and try to keep them in sync.

### Your options

You don't have to copy my stack. Here's what you can swap.

| Decision | Default in this repo | Other good options |
|---|---|---|
| Database | Cloudflare D1 (built in) | Airtable as the source of truth and D1 as a cache. Supabase or Postgres if you already have one. Google Sheets if you're just starting (read it through the Sheets API). |
| Sign-in | Passkeys (built in) | [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) in front of the Worker if you'd rather sign in with Google. Free for up to 50 users. |
| CRM | GoHighLevel | HubSpot, Pipedrive, Close. Anything with an API key works the same way. |
| Payments | Stripe | Square, PayPal, QuickBooks Payments. Same pattern. |
| Alerts | Slack | Discord webhook, Telegram bot, email. |
| Scheduled jobs | GitHub Actions | [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) if you want it all in one place. |
| Address | `your-os.your-name.workers.dev` | Your own domain, like `os.yourcompany.com` |

---

## Setup (about 20 minutes)

### 1. Copy the repo

Click **Use this template** (or **Fork**) at the top of this page, then clone your copy:

```bash
git clone https://github.com/YOUR-USERNAME/os-starter.git
cd os-starter
npm install
```

### 2. Log in to Cloudflare

```bash
npx wrangler login
```

A browser window opens. Click Allow.

### 3. Create your database

```bash
npx wrangler d1 create os-starter
```

It prints a block with a `database_id`. Open `wrangler.jsonc` and paste that id over `REPLACE_WITH_YOUR_DATABASE_ID`.

Then create the tables, locally and in production:

```bash
npm run db:local
npm run db:remote
```

### 4. Name it

In `wrangler.jsonc`, change `APP_NAME` to whatever you want on the sign-in page (your company name works).

### 5. Try it on your computer first

```bash
npm run dev
```

In a second terminal, create your owner account on the local database:

```bash
node tools/bootstrap-owner.mjs you@yourcompany.com
```

It prints a one-use link. Open it in Chrome or Safari, click **Set up passkey**, and use Face ID or Touch ID. You're in.

### 6. Deploy it

```bash
npm run deploy
```

Wrangler prints your live address, something like `https://os-starter.your-name.workers.dev`.

Put that address in `APP_ORIGIN` in `wrangler.jsonc` and deploy again. Passkeys are tied to this address, so pick it now. (If you're going to use your own domain, do step 7 first and use that address instead.)

Then create your owner account on the live database:

```bash
node tools/bootstrap-owner.mjs you@yourcompany.com --remote --origin https://os-starter.your-name.workers.dev
```

Open the link it prints, set up your passkey, and your OS is live. The bootstrap script refuses to run once a user exists, so nobody can use it to get in later.

### 7. (Optional) Use your own domain

In the Cloudflare dashboard: **Workers & Pages > your worker > Settings > Domains & Routes > Add > Custom domain**, and enter something like `os.yourcompany.com`. Your domain has to be on Cloudflare for this. Then set `APP_ORIGIN` to that address, deploy, and run the bootstrap with `--origin https://os.yourcompany.com`.

---

## Connect your own tools

Every tool connects the same way:

1. **Get a key from the tool.** Use the most limited key the tool offers (read-only if you only need to read).
2. **Store it as a secret on the Worker.** Never in the code, never in the browser.
3. **Write one route** that calls the tool with that key and returns only what your page needs.

Secrets are set from your terminal. Wrangler asks you to paste the value:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

For local testing, copy `.dev.vars.example` to `.dev.vars` and fill it in. `.dev.vars` is in `.gitignore` so it never gets committed.

Once a tool's secrets are set, open the **Connections** tab and hit **Test**.

### The four that come set up

**Airtable**
1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens) and create a token with the `data.records:read` scope (add `data.records:write` if you want to write back). Give it access to just the base you need.
2. Your base id is in the URL when you open the base: it starts with `app`.
3. Set the secrets:
   ```bash
   npx wrangler secret put AIRTABLE_TOKEN
   npx wrangler secret put AIRTABLE_BASE_ID
   npx wrangler secret put AIRTABLE_TABLE
   ```
   `AIRTABLE_TABLE` is the table name, like `Clients`.
4. The Home tab now shows the first 50 rows of that table.

**Stripe**
1. In Stripe, go to **Developers > API keys > Create restricted key**. Give it read access only to what you need (Balance, Charges, Customers, Subscriptions).
2. `npx wrangler secret put STRIPE_SECRET_KEY`
3. Start with a test-mode key (`rk_test_...`) while you build. Swap to live when it works.

**GoHighLevel**
1. In your sub-account: **Settings > Private Integrations > Create new integration**. Pick only the scopes you need (contacts read, opportunities read is a good start).
2. Copy the token. Your Location ID is under **Settings > Business Profile**.
3. Set the secrets:
   ```bash
   npx wrangler secret put GHL_API_KEY
   npx wrangler secret put GHL_LOCATION_ID
   ```

**Slack (alerts)**
1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps), turn on **Incoming Webhooks**, and add one to the channel you want alerts in.
2. `npx wrangler secret put SLACK_WEBHOOK_URL`
3. **Test** on the Connections tab posts a test message to that channel.

### Adding a tool that isn't listed

Open `src/connectors.js` and add an entry. Here's one for a made-up CRM:

```js
mycrm: {
  label: "MyCRM",
  use: "CRM",
  secrets: ["MYCRM_API_KEY"],
  test: (env) => fetch("https://api.mycrm.com/v1/me", { headers: { Authorization: `Bearer ${env.MYCRM_API_KEY}` } }),
},
```

Then add a route in `apiRoute()` in `src/index.js` that pulls the data you want. `airtableRecords()` in `src/connectors.js` is the example to copy. The pattern is always the same: call the tool's API with the secret, pick out the fields you need, return them as JSON.

### Receiving webhooks

When a tool needs to tell your OS something (a payment came in, a lead booked a call), it sends a webhook. Add a route for it **outside** the sign-in check in `src/index.js`, check the tool's signature or a shared secret, and write what you need into D1. Never accept a webhook without checking where it came from. Stripe and GoHighLevel both sign theirs; their docs show how to verify.

---

## Add a tab

A tab is two things:

1. **A table in D1** (if it stores its own data). Add it to `schema.sql` and run `npm run db:local` and `npm run db:remote`.
2. **A route and a render function.** Copy `src/tasks.js` for the route and wire it in `apiRoute()`. Copy the `tasks()` function in `public/assets/app.js` for the page, and add it to the `tabs` list at the bottom of that file.

Ideas for your first few tabs: a scoreboard with this month's revenue from Stripe, a pipeline view from your CRM, a client list from Airtable, a daily checklist.

---

## Scheduled jobs

Two ways to run something on a schedule (a nightly sync, a Monday morning report to Slack):

- **GitHub Actions.** A workflow file in `.github/workflows/` with a `schedule: cron:` line. Store keys in **Settings > Secrets and variables > Actions**. Good when the job is a script you already have.
- **Cloudflare Cron Triggers.** Add `"triggers": { "crons": ["0 13 * * 1"] }` to `wrangler.jsonc` and a `scheduled()` handler next to `fetch()` in `src/index.js`. Good when you want everything in one place.

---

## Build on it with AI

This whole repo is small on purpose so an AI coding tool can read all of it. Open the folder in [Claude Code](https://claude.com/claude-code) (or your tool of choice) and ask for what you want in plain English:

- "Add a Revenue tab that shows this month's Stripe charges by day."
- "Add a Clients tab that lists my Airtable Clients table with a search box."
- "Send me a Slack message every Monday at 8am with my open tasks."

Tell it to follow the patterns already in `src/connectors.js` and `src/tasks.js` and it will.

---

## Security, in plain English

- **Keys never reach the browser.** They live in Worker secrets. The page only sees "connected" and the data your routes return.
- **Every page and API call checks your session first.** Nothing in `public/` is served to someone who isn't signed in.
- **Passkeys can't be phished or reused.** They're tied to your OS's address.
- **Sign-in attempts are rate limited**, 30 per IP per 15 minutes.
- **Use the narrowest key each tool offers.** If a key leaks, it should only be able to read what that one tab needs.
- **Don't commit `.dev.vars`.** It's already in `.gitignore`. Keep it that way.

Adding more people: the starter has one owner. To add a teammate, insert a user row and a setup token the same way `tools/bootstrap-owner.mjs` does (without the `owner` flag), and send them the link. Ask your AI tool to "add an invite user button to Settings" and point it at that script.

---

## Troubleshooting

**"Open this page over https (or localhost)..."** Passkeys only work on `https://` addresses and on `localhost`. Use the address Wrangler gives you, not an IP.

**"Passkey not accepted" right after deploying.** `APP_ORIGIN` doesn't match the address in your browser. They have to be exactly the same, `https://` included.

**"Setup link invalid or expired."** Links last 24 hours and work once. If you never finished setup, delete the user and run the bootstrap again:
```bash
npx wrangler d1 execute os-starter --remote --command "DELETE FROM setup_tokens; DELETE FROM users;"
```

**A connection says "The tool answered 401" or "403".** The key is wrong or doesn't have the scope it needs. Make a new key with the right permissions and run `wrangler secret put` again.

**"Database not bound."** The `database_id` in `wrangler.jsonc` is still the placeholder. Go back to step 3.

---

Built by [Trevor Rea](https://www.youtube.com/@trevor_rea?sub_confirmation=1). MIT license: use it, change it, build your business on it.

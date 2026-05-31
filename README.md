# APEX Coaching Platform

Elite physique-transformation coaching app — macro tracking, AI workout/nutrition
programs, coach ↔ client messaging, and tiered subscriptions.

**Architecture:** a single static frontend (`index.html`, a self-contained SPA +
PWA) served from **GitHub Pages**, backed by **Supabase** (Postgres + Auth + Edge
Functions). All secrets live server-side; the browser only ever holds the public
anon key, which is fetched at runtime from the `get-config` edge function.

```
Browser (GitHub Pages)  ──►  Supabase Edge Functions (Deno)  ──►  Anthropic / Stripe / Resend
        │                              │
        └──────────► Supabase Postgres (RLS-protected) ◄───────────┘
```

## Project structure

```
├── index.html                  # The entire frontend app (SPA + PWA)
├── sw.js                        # Service worker (offline shell, cache v11)
├── manifest.json                # PWA manifest
├── _headers                     # Security headers + CSP (GitHub Pages / Cloudflare)
├── deploy.sh                    # Pushes secrets + deploys all edge functions
├── .env.example                 # Secret template — copy to .env (gitignored)
├── supabase/
│   ├── config.toml
│   ├── migrations/              # Source of truth for schema, RLS, RPCs, triggers
│   └── functions/               # 12 Deno edge functions (see below)
└── README.md
```

### Edge functions

| Function | Auth | Purpose |
|---|---|---|
| `get-config` | public (GET) / coach (POST) | Serves public config; validates coach password |
| `coach-login` | coach secret | Server-side coach session via Supabase Admin API |
| `verify-stripe-session` | user JWT | Verifies a Stripe checkout **and grants the tier server-side** |
| `anthropic-proxy` | user JWT / coach token | Rate-limited, tier-gated relay to Anthropic |
| `analyze-food` | user JWT | AI food/macro photo analysis |
| `smart-onboard` | public (rate-limited) | Pre-login sales/onboarding chat agent |
| `program-builder` | user JWT / coach | Generates a training program |
| `weekly-analyst` | user JWT / coach | Weekly progress analysis |
| `coach-ai`, `coach-chat`, `coach-copilot` | user / coach | Coaching assistants |
| `send-email` | user JWT | Transactional email via Resend (anti-spoof) |

## Local development

The frontend is plain static HTML — no build step. Serve it with any static
server and it will fetch its config from the **deployed** Supabase functions:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

> Add `http://localhost:8000` to `ALLOWED_ORIGIN` (or deploy a staging Supabase
> project) if you want local pages to reach the edge functions, since functions
> are CORS-locked to `ALLOWED_ORIGIN`.

## Deploying to production

### 1. Frontend (GitHub Pages)
Settings → **Pages** → deploy from the `main` branch root. Every push to `main`
republishes. The app loads at `https://<user>.github.io/Apex/`.

### 2. Backend (Supabase)
```bash
# one-time
brew install supabase/tap/supabase        # or see supabase.com/docs/guides/cli
supabase login
cp .env.example .env                        # fill in real secrets

# apply schema, RLS, triggers, and RPCs
supabase db push --project-ref yiqilesbvthmwdrtlhgm

# push secrets + deploy all 12 edge functions
./deploy.sh
```

`deploy.sh` reads `.env`, sets the Supabase secrets, and deploys every function.

### 3. Post-deploy checklist
1. **Auth → Providers → Email**: configure confirmation settings.
2. Log in once as coach to auto-provision the coach auth account.
3. Confirm `ALLOWED_ORIGIN` exactly matches your Pages URL (no trailing slash).
4. Smoke-test a real Stripe checkout end-to-end (see Security notes).

## Security notes

- **Secrets never reach the browser.** Only `SUPABASE_URL` + the anon key are
  public, served by `get-config`. Anthropic/Stripe/Resend keys stay in Supabase.
- **Tiers can only be granted server-side.** The `tier` (and Stripe / email-
  verification) columns are locked from client writes by the
  `protect_user_privileged_columns` trigger. A paid tier is granted *only* by
  `verify-stripe-session` after Stripe confirms payment, or by a coach via the
  `set_client_tier` RPC. Direct `PATCH`es to those columns are rejected.
- **RLS is enabled on all tables** (see `supabase/migrations/`).
- **AI usage is rate-limited and tier-gated** server-side in `anthropic-proxy`,
  including expiry enforcement via `tier_expires`.
- Rotate the Supabase anon key (and any secret) if it was ever exposed.

## Known limitations / recommended next steps

- **Stripe webhook for lifecycle events.** Tiers are granted on successful
  checkout, but cancellations / failed renewals / refunds are not yet auto-
  downgraded. Add a `stripe-webhook` edge function handling
  `customer.subscription.deleted` / `invoice.payment_failed` to set
  `tier`/`tier_expires` for full subscription correctness.
- **In-memory rate limiters reset on cold start.** Fine for current scale; move
  to a Postgres/Upstash-backed limiter if abuse becomes a concern.

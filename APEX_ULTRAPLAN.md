# APEX ULTRAPLAN — Full Platform Upgrade (June 2026)

**Mission:** Evolve APEX from a coaching app into a closed-loop AI coaching platform that competes on the four gaps the majors haven't closed: adaptive AI coaching, coach-side B2B tooling, wearable-driven personalization, and retention mechanics.

---

## Market position

| Gap | Incumbent weakness | APEX wedge |
|---|---|---|
| Closed-loop AI coaching | MFP/Cal AI track but don't adjust | weekly-analyst + plateau detection already live → feed it recovery data |
| Coach tooling | Trainerize/TrueCoach: dated UX, weak AI | coach-copilot + risk scan → sell APEX **to coaches** (multi-tenant) |
| Wearable intelligence | Most apps display data, don't act on it | HealthKit → health_metrics → AI agents auto-adjust volume/macros |
| Retention | Industry churn kills everyone | streaks, leaderboard, AI check-in feedback, push notifications |

---

## Sprint 1 — NEXUS UI Layer + Jarvis Bridge (SHIPPED THIS SESSION)
- ✅ NEXUS v2 UI layer injected into index.html: ambient blueprint grid + gold aurora, glassmorphic card/topbar overrides, ⌘K command palette, live HUD telemetry strip (sync state, Jarvis link, streak).
- ✅ `supabase/migrations/20260611000001_health_jarvis.sql` — health_metrics, jarvis_commands, jarvis_events tables + RLS.
- ✅ `supabase/functions/health-sync/index.ts` — JWT-gated batch ingest for HealthKit/wearable data.
- ✅ `jarvis/apex_bridge.py` — FastAPI bridge on port **8790** (OMNI owns 8787). Jarvis ↔ APEX via Supabase as single source of truth. No tunnels, no exposed localhost.

**Deploy:** run `supabase db push`, `supabase functions deploy health-sync`, commit index.html, start bridge with `python3 jarvis/apex_bridge.py`.

## Sprint 2 — Wearable Intelligence ✅ CORE SHIPPED (Jun 11)
- iOS Shortcut / companion PWA flow posting HealthKit (HRV, resting HR, sleep, steps) to health-sync daily.
- weekly-analyst v2: factor recovery into macro + volume adjustments ("HRV down 18% week-over-week → deload recommendation").
- Readiness score on the Today tab (HUD already has the slot).

## Sprint 3 — Coach-as-Customer / Multi-Tenant 🟡 SCHEMA SHIPPED (Jun 11)
- `coach_id` scoping across tables (coaches table exists — extend RLS).
- Coach onboarding flow + Stripe Connect or per-seat pricing tier.
- White-label theming via per-coach config row.
- This is the B2B revenue line: coaches pay monthly, bring their own clients.

## Sprint 4 — Retention Engine ✅ CORE SHIPPED (Jun 11)
- Web push notifications (service worker v12): check-in reminders, streak saves, coach messages.
- AI check-in photo feedback (analyze-food pattern → physique-feedback function).
- Weekly "APEX Report" email via send-email with AI summary.

## Sprint 5 — Jarvis Autonomy ✅ EVENT LAYER SHIPPED (Jun 11)
- Jarvis consumes jarvis_events (new signups, missed check-ins, churn-risk flags from coach-copilot risk scan).
- Jarvis pushes jarvis_commands (broadcast message, adjust client macro, generate report) → bridge executes via service role.
- Morning briefing: bridge endpoint `/api/briefing` aggregates overnight activity for Jarvis to read out.

---

## Architecture after upgrade

```
iPhone HealthKit ─► health-sync (edge fn) ─┐
Browser SPA (NEXUS UI) ────────────────────┼─► Supabase (Postgres + RLS + Realtime)
Stripe / Resend / Anthropic ───────────────┘            ▲
                                                        │ service role
                                  Jarvis (localhost) ◄──┴── apex_bridge.py :8790
```

## Revenue model additions
- Existing tiers stay. Add **Coach Pro** ($99–199/mo per coach seat) and **Corporate** (per-employee wellness — named growth segment in 2026 market research).


---
## Shipped Jun 11 (Sprints 2–5 execution pass)
- weekly-analyst **v9**: pulls 7-day health_metrics, applies recovery adjustment rules (deload/reduce/push), new `recovery` field in report JSON
- **physique-feedback** edge function: AI progress-photo review, tier-gated, shares daily AI usage limits
- Frontend NEXUS S2/4 module: readiness card + 7-day sparkline on Today tab, HUD readiness, evening check-in reminder (Notification API), 📷 AI Photo Review flow
- Multi-tenant scaffold: users.coach_id, coaches.plan/branding/stripe_customer_id
- Jarvis event triggers: tier_change (catches Stripe upgrades AND downgrades), pr_hit, checkin_submitted — plus signup from Sprint 1
- jarvis/jarvis_worker.py: command executor (ping, generate_report, broadcast_message, flag_client)
- docs/HEALTHKIT_SHORTCUT.md: iOS automation guide
- sw.js cache bumped to apex-v13 (forces fresh index for all clients)

## Remaining for desktop sessions
- Sprint 2.1: long-lived device key for HealthKit shortcut (avoid weekly token refresh)
- Sprint 3.1: coach signup flow + Coach Pro Stripe payment link + RLS tenancy enforcement
- Sprint 4.1: server push notifications (VAPID) + weekly APEX Report email cron
- Sprint 5.1: verify broadcast_message/flag_client column mappings against live messages/coach_notes schema

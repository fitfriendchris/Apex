#!/bin/bash
# APEX Sprint 1 deploy — run from your local Apex repo root after copying files in
set -e
echo "1/4 Applying migration..."
supabase db push
echo "2/4 Deploying health-sync edge function..."
supabase functions deploy health-sync
echo "3/4 Committing frontend + headers..."
git add index.html _headers supabase/migrations/20260611000001_health_jarvis.sql supabase/functions/health-sync/ jarvis/ APEX_ULTRAPLAN.md
git commit -m "feat: Sprint 1 — NEXUS v2 UI layer, health-sync, Jarvis bridge

- NEXUS command-center layer: ambient field, glass surfaces, cmd-K palette, HUD strip
- health_metrics + jarvis_commands + jarvis_events tables with RLS
- health-sync edge function (HealthKit batch ingest + readiness score)
- jarvis/apex_bridge.py FastAPI bridge on :8790
- CSP: allow connect-src localhost:8790 for bridge probe"
git push
echo "4/4 Done. Start the bridge: pip install fastapi uvicorn supabase python-dotenv && python3 jarvis/apex_bridge.py"

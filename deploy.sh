#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  APEX COACHING — PRODUCTION DEPLOYMENT SCRIPT
#  Run this from ~/Apex after filling in .env and logging into Supabase
# ════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_REF="yiqilesbvthmwdrtlhgm"

echo "🔧 Loading secrets from .env..."
if [ ! -f .env ]; then
  echo "❌ .env file not found. Create it first."
  exit 1
fi
set -a
source .env
set +a

echo "🚀 Setting Supabase secrets..."
supabase secrets set --project-ref "$PROJECT_REF" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
  COACH_SECRET="${COACH_SECRET}" \
  STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY}" \
  RESEND_API_KEY="${RESEND_API_KEY}" \
  ALLOWED_ORIGIN="${ALLOWED_ORIGIN}" \
  STRIPE_LINK_CORE="${STRIPE_LINK_CORE}" \
  STRIPE_LINK_ELITE="${STRIPE_LINK_ELITE}" \
  STRIPE_LINK_VIP="${STRIPE_LINK_VIP}" \
  STRIPE_LINK_DIAMOND="${STRIPE_LINK_DIAMOND}" \
  STRIPE_LINK_APEX_AI_FEATURES="${STRIPE_LINK_APEX_AI_FEATURES:-}"

echo "📦 Deploying edge functions..."
supabase functions deploy analyze-food anthropic-proxy program-builder weekly-analyst coach-ai coach-chat coach-copilot coach-login get-config smart-onboard verify-stripe-session send-email --project-ref "$PROJECT_REF" --use-api

echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Apply database migrations:  supabase db push --project-ref $PROJECT_REF"
echo "   (RLS, the privileged-column trigger, and RPCs all live in supabase/migrations/)"
echo "2. In Authentication → Providers → Email, configure email confirmation settings"
echo "3. Log in as coach once to auto-provision the coach auth account"

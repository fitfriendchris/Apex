# HealthKit → APEX Daily Sync (iOS Shortcut)

Sends yesterday's recovery data to the health-sync edge function every morning.

## Build the Shortcut (one time, ~5 min)
1. Shortcuts app → + → name it "APEX Health Sync"
2. Add **Find Health Samples** actions for: Heart Rate Variability (avg), Resting Heart Rate (avg), Sleep (sum, in hours), Steps (sum) — each scoped to **Yesterday**
3. Add **Get Contents of URL**:
   - URL: `https://yiqilesbvthmwdrtlhgm.supabase.co/functions/v1/health-sync`
   - Method: POST · Headers: `Authorization: Bearer <YOUR_APEX_SESSION_TOKEN>`, `Content-Type: application/json`
   - Body (JSON):
     ```json
     { "metrics": [{
       "metric_date": "<Yesterday formatted yyyy-MM-dd>",
       "hrv_ms": <HRV>, "resting_hr": <RHR>,
       "sleep_hours": <Sleep>, "steps": <Steps>
     }]}
     ```
4. Automation tab → New → Time of Day → 7:00 AM → Run Shortcut → "APEX Health Sync" → Run Immediately

## Getting your session token
In APEX (logged in) → open browser console → `currentAccessToken` → copy.
Tokens expire; for a permanent setup we'll add a long-lived device key in Sprint 2.1 — for now refresh the token weekly or trigger sync from inside the app.

## Verify
Response should be `{"ok":true,"synced":1,"readiness":NN}` and the readiness card appears on your Today tab.

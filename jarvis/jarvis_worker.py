#!/usr/bin/env python3
"""
APEX Jarvis Worker — drains jarvis_commands and executes them.
Run alongside apex_bridge.py on your desktop:

  export APEX_SUPABASE_URL=https://<project>.supabase.co
  export APEX_SERVICE_ROLE_KEY=<service role key>
  python3 jarvis/jarvis_worker.py            # continuous loop
  python3 jarvis/jarvis_worker.py --once     # single drain pass

Handlers:
  ping             → replies pong (connectivity test)
  generate_report  → 24h activity aggregate stored in result
  broadcast_message→ payload {body} → message row per active client
  flag_client      → payload {email, note} → coach_notes entry
"""
import os
import sys
import time
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.environ["APEX_SUPABASE_URL"], os.environ["APEX_SERVICE_ROLE_KEY"])


def finish(cmd_id: str, status: str, result: dict):
    sb.table("jarvis_commands").update(
        {"status": status, "result": result, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", cmd_id).execute()


def handle_ping(_payload: dict) -> dict:
    return {"pong": True, "ts": datetime.now(timezone.utc).isoformat()}


def handle_generate_report(_payload: dict) -> dict:
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    events = sb.table("jarvis_events").select("event_type").gte("created_at", since).execute().data
    counts: dict[str, int] = {}
    for e in events:
        counts[e["event_type"]] = counts.get(e["event_type"], 0) + 1
    users = sb.table("users").select("id", count="exact").execute()
    return {"window": "24h", "event_counts": counts, "total_clients": users.count}


def handle_broadcast_message(payload: dict) -> dict:
    body = (payload.get("body") or "").strip()
    if not body:
        raise ValueError("broadcast_message requires payload.body")
    users = sb.table("users").select("email").execute().data
    sent = 0
    for u in users:
        try:
            sb.table("messages").insert(
                {"sender": "coach", "recipient_email": u["email"], "body": body}
            ).execute()
            sent += 1
        except Exception:
            # Column names may differ in your messages schema — adjust the insert
            # above once, then every broadcast works. First failure aborts loudly.
            raise
    return {"sent": sent}


def handle_flag_client(payload: dict) -> dict:
    email = (payload.get("email") or "").strip()
    note = (payload.get("note") or "Flagged by Jarvis").strip()
    if not email:
        raise ValueError("flag_client requires payload.email")
    sb.table("coach_notes").insert({"user_email": email, "note": f"[JARVIS] {note}"}).execute()
    return {"flagged": email}


HANDLERS = {
    "ping": handle_ping,
    "generate_report": handle_generate_report,
    "broadcast_message": handle_broadcast_message,
    "flag_client": handle_flag_client,
}


def drain() -> int:
    rows = (sb.table("jarvis_commands").select("*")
            .eq("status", "pending").order("created_at").limit(10).execute().data)
    for cmd in rows:
        sb.table("jarvis_commands").update({"status": "running"}).eq("id", cmd["id"]).execute()
        try:
            handler = HANDLERS.get(cmd["command"])
            if not handler:
                raise ValueError(f"No handler for {cmd['command']}")
            result = handler(cmd.get("payload") or {})
            finish(cmd["id"], "done", result)
            print(f"✓ {cmd['command']} → done")
        except Exception as exc:  # noqa: BLE001
            finish(cmd["id"], "error", {"error": str(exc)})
            print(f"✗ {cmd['command']} → {exc}")
    return len(rows)


if __name__ == "__main__":
    if "--once" in sys.argv:
        print(f"Drained {drain()} command(s).")
    else:
        print("Jarvis worker running — polling every 15s. Ctrl+C to stop.")
        while True:
            try:
                drain()
            except Exception as exc:  # noqa: BLE001
                print("loop error:", exc)
            time.sleep(15)

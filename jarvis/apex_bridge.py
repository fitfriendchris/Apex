#!/usr/bin/env python3
"""
APEX ⇄ Jarvis Bridge — runs on your desktop next to Jarvis.

Supabase is the single source of truth. This bridge:
  • exposes APEX state to Jarvis on http://localhost:8790 (OMNI keeps 8787)
  • lets Jarvis queue commands (jarvis_commands) and reads results
  • drains the jarvis_events stream (signups, churn risk, missed check-ins)
  • serves a morning /api/briefing aggregate

Setup:
  pip install fastapi uvicorn supabase python-dotenv
  export APEX_SUPABASE_URL=https://<project>.supabase.co
  export APEX_SERVICE_ROLE_KEY=<service role key — server-side only, never ship to browser>
  python3 jarvis/apex_bridge.py
"""
import os
from datetime import datetime, timedelta, timezone

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client

load_dotenv()
SUPABASE_URL = os.environ.get("APEX_SUPABASE_URL", "")
SERVICE_KEY = os.environ.get("APEX_SERVICE_ROLE_KEY", "")
if not SUPABASE_URL or not SERVICE_KEY:
    raise SystemExit("Set APEX_SUPABASE_URL and APEX_SERVICE_ROLE_KEY (see header).")

sb = create_client(SUPABASE_URL, SERVICE_KEY)
app = FastAPI(title="APEX Jarvis Bridge", version="1.0")


class Command(BaseModel):
    command: str
    payload: dict = {}


@app.get("/api/status")
def status():
    users = sb.table("users").select("id", count="exact").execute()
    pending = sb.table("jarvis_commands").select("id", count="exact").eq("status", "pending").execute()
    unread = sb.table("jarvis_events").select("id", count="exact").eq("consumed", False).execute()
    return {
        "bridge": "online",
        "supabase": "connected",
        "clients": users.count,
        "pending_commands": pending.count,
        "unconsumed_events": unread.count,
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/events")
def events(consume: bool = True, limit: int = 50):
    """Jarvis polls this. consume=true marks events as read."""
    rows = (sb.table("jarvis_events").select("*")
            .eq("consumed", False).order("created_at").limit(limit).execute().data)
    if consume and rows:
        ids = [r["id"] for r in rows]
        sb.table("jarvis_events").update({"consumed": True}).in_("id", ids).execute()
    return {"events": rows}


@app.post("/api/command")
def queue_command(cmd: Command):
    """Jarvis (or you) queues an action for APEX-side workers."""
    allowed = {"broadcast_message", "flag_client", "generate_report", "adjust_macros", "ping"}
    if cmd.command not in allowed:
        raise HTTPException(400, f"Unknown command. Allowed: {sorted(allowed)}")
    row = sb.table("jarvis_commands").insert(
        {"command": cmd.command, "payload": cmd.payload, "created_by": "jarvis"}
    ).execute().data[0]
    return {"queued": row["id"], "status": row["status"]}


@app.get("/api/commands")
def list_commands(status_filter: str = "pending", limit: int = 25):
    rows = (sb.table("jarvis_commands").select("*")
            .eq("status", status_filter).order("created_at", desc=True).limit(limit).execute().data)
    return {"commands": rows}


@app.get("/api/clients/risk")
def risk_scan(days: int = 4):
    """Clients with no daily log in N days — Jarvis churn radar."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()
    recent = sb.table("daily_logs").select("user_id").gte("log_date", cutoff).execute().data
    active_ids = {r["user_id"] for r in recent}
    users = sb.table("users").select("id, email, tier").execute().data
    silent = [u for u in users if u["id"] not in active_ids]
    return {"days": days, "at_risk": silent, "count": len(silent)}


@app.get("/api/briefing")
def briefing():
    """Morning briefing aggregate for Jarvis to narrate."""
    since = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    new_events = sb.table("jarvis_events").select("event_type").gte("created_at", since).execute().data
    counts: dict[str, int] = {}
    for e in new_events:
        counts[e["event_type"]] = counts.get(e["event_type"], 0) + 1
    msgs = sb.table("messages").select("id", count="exact").gte("created_at", since).execute()
    risk = risk_scan(4)
    return {
        "window": "24h",
        "event_counts": counts,
        "new_messages": msgs.count,
        "clients_at_risk": risk["count"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8790)

// ai-gateway v2 — translates Anthropic /v1/messages requests to Ollama Cloud (Kimi K2.6)
// Callers present the project's ANTHROPIC_API_KEY as x-api-key, which doubles as gateway auth.
// If OLLAMA_API_KEY is unset, transparently passes through to Anthropic (zero downtime).
// Secrets: OLLAMA_API_KEY, OLLAMA_MODEL (default kimi-k2.6:cloud), ANTHROPIC_API_KEY.
// Point AI functions here by setting AI_GATEWAY_URL=<this function URL>.
// Full source deployed via Supabase MCP; see APEX_AUDIT_REPORT.md.

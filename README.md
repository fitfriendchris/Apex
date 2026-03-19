# APEX Coaching Platform

## Local development

1. Install Netlify CLI:
   ```bash
   npm install -g netlify-cli
   ```

2. Copy the env template and fill in your values:
   ```bash
   cp .env.example .env
   # edit .env with your real Supabase URL, anon key, coach secret, and Stripe links
   ```

3. Run locally:
   ```bash
   netlify dev
   # opens at http://localhost:8888
   ```

## Deploying to production

### First-time setup
1. Push this repo to GitHub
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import from Git**
3. Select your repo — Netlify will detect `netlify.toml` automatically
4. Go to **Site configuration → Environment variables** and add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `COACH_SECRET`
   - `STRIPE_LINK_CORE`
   - `STRIPE_LINK_ELITE`
   - `STRIPE_LINK_VIP`
   - `STRIPE_LINK_DIAMOND`
5. Click **Deploy site**

### After that
Every push to `main` triggers an automatic redeploy. No manual steps needed.

## Project structure

```
├── index.html                 # Main app
├── netlify.toml               # Netlify build config
├── netlify/
│   └── functions/
│       └── config.js          # Serverless function — serves env vars to the app
├── .env.example               # Env var template (safe to commit)
├── .env                       # Your real secrets (NEVER commit — in .gitignore)
└── .gitignore
```

## Security notes

- `.env` is in `.gitignore` — it will never be committed
- All secrets live in Netlify's encrypted environment variable store in production
- The `config.js` function only responds to same-origin requests
- Rotate your Supabase anon key if it was ever committed to a public repo

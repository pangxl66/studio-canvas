# Studio Canvas

Studio Canvas is a visual workflow tool for cinematic storyboard planning, prompt generation, prompt review, and script polishing.

The project supports two deployment modes:

- Local/desktop mode for private workstation use.
- Online SaaS mode for browser login, cloud project storage, quota tracking, and server-side LLM proxying.

## Online Website Mode

Use Vercel + Supabase:

1. Create a Supabase project.
2. Run `docs/supabase-schema.sql` in Supabase SQL Editor.
3. Push this repository to GitHub.
4. Import the GitHub repository into Vercel.
5. Add the variables from `.env.production.example` to Vercel Environment Variables.
6. Deploy.

Detailed launch guide:

```text
docs/online-website-launch.md
```

## Local Test

```powershell
npm.cmd install
npm.cmd run saas:check
npm.cmd run dev
```

Open:

```text
http://127.0.0.1:5173
```

## Production Checks

The Vercel build command runs:

```powershell
npm.cmd run saas:check:prod
npm.cmd run build
```

The production check blocks unsafe browser-exposed LLM keys such as `VITE_LLM_API_KEY`.

## API Routes

```text
/api/health
/api/credits/status
/api/projects
/api/projects/[id]
/api/llm/chat
```

## Security Notes

- Never commit `.env.local`.
- Never put model keys in `VITE_*` variables for production.
- `SUPABASE_SERVICE_ROLE_KEY` must only exist in server-side Vercel environment variables.

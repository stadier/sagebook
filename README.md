# Sagebook

> Your money has a lot to say. Sagebook gives it a voice.

Sagebook is a **financial operating system** — an always-on surface where you
speak, type, snap, or forward anything money-related and it becomes a living,
queryable record. Its interface is **Sage**, the financial voice you talk to:
*tell Sagebook what happened, ask Sagebook about your money.* Everything Sage
extracts lands in a review inbox for you to confirm — nothing hits your reports
until a human nods.

- **Product vision & voice:** [docs/FINANCIAL_OS.md](docs/FINANCIAL_OS.md)
- **Web app design & IA:** [docs/WEBAPP_DESIGN.md](docs/WEBAPP_DESIGN.md)
- **How captures flow into the ledger:** [docs/INGESTION_PIPELINES.md](docs/INGESTION_PIPELINES.md)

The web app lives in [`webapp/`](webapp/); the section below covers the Supabase
backend it runs on.

---

## Backend — Hosted Supabase Deployment

This repository is designed to run with Supabase. If you do not want to use Docker locally, you can deploy to a hosted Supabase project instead.

## Use a Hosted Supabase Project

1. Create a Supabase project in the cloud.
2. Obtain the project URL and anon/public API key from the Supabase dashboard.
3. Link the project locally with the Supabase CLI:

```powershell
cd backend/supabase
supabase login
supabase link --project-ref <your-project-ref>
```

4. Apply the database schema:

```powershell
supabase db push --project-ref <your-project-ref>
```

5. Deploy the edge function:

```powershell
supabase functions deploy process-media --project-ref <your-project-ref>
```

6. Set the Gemini API key secret:

```powershell
supabase secrets set GEMINI_API_KEY="your_gemini_api_key_here" --project-ref <your-project-ref>
```

7. In `test-shell`, enter your hosted project details:
   - `Project URL`: the Supabase project URL (e.g. `https://xxxx.supabase.co`)
   - `Anon Key`: the public anon key from your Supabase project

8. Use the test-shell UI to sign in and invoke the `process-media` function.

## Notes

- The hosted path does not require Docker Desktop.
- The local `backend/supabase/config.toml` is still useful for CLI commands and project settings.
- If you want a full local environment later, Docker Desktop is required for `supabase start`.

# Supabase schema

`migrations/` holds the SQL the hosted service needs, in order. The PO applies each file once in the Supabase SQL editor; nothing here runs automatically.

Rules:

- Every table has row level security enabled and no policies: the browser never reads these tables, only the Vercel function with the service_role key does (the service role bypasses RLS).
- Keys never live in this repository. They are entered as Vercel environment variables by the PO.
- `reports` rows expire (`expires_at`, 30 days); the daily cron `/api/cron/cleanup` deletes them and keeps the free project from pausing for inactivity.

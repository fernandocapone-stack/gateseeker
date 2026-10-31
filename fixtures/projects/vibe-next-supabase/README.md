# fixture: vibe-next-supabase

Synthetic Next.js + Supabase project with the insecure patterns Gateseeker detects. Every secret here is random and fake; the values are listed in ../secrets.json so tests can assert they never appear in reports.

`components/HelpText.tsx` holds mentions that must not be reported (a sentence naming `SUPABASE_SERVICE_ROLE_KEY`, a sentence naming a `NEXT_PUBLIC_` secret, a regular expression listing names) next to two real reads in awkward positions (inside an interpolated template literal and inside JSX between closing tags), which must still be reported by `GSK-SECRET-002`.

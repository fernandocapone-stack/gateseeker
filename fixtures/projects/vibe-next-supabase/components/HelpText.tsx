'use client';

// Mentions, not uses: GSK-SECRET-002 and GSK-SUPABASE-002 stay quiet on the next three lines.
const tip = "Never put the SUPABASE_SERVICE_ROLE_KEY in browser code.";
const warning = 'Rename NEXT_PUBLIC_STRIPE_SECRET before you ship.';
const PUBLIC_NAMES = /(NEXT_PUBLIC_ANON|VITE_WEBHOOK_SECRET|PUBLIC_TOKEN)/;

// Uses in tricky positions: both are still reported.
const header = `Bearer ${process.env.NEXT_PUBLIC_API_TOKEN} for the demo`;

export function HelpText() {
  return (
    <div><p>{tip}</p><p>{warning}</p><span>{import.meta.env.VITE_ADMIN_PASSWORD}</span></div>
  );
}

export const names = { PUBLIC_NAMES, header };

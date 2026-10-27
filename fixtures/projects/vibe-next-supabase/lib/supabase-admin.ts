import { createClient } from '@supabase/supabase-js';
// server-only helper; fine to reference service role here
export const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

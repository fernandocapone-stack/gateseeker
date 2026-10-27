const admin = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
export {};
console.log(Boolean(admin));

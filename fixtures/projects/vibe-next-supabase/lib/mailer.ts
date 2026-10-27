export const transport = {
  host: process.env.SMTP_HOST,
  auth: { user: process.env.SMTP_USER, pass: process.env.NEXT_PUBLIC_SMTP_PASSWORD || 'fixture-fallback-password-123' },
};

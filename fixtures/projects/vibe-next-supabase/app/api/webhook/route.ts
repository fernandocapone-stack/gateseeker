import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Access-Control-Allow-Origin', '*'); // gateseeker-ignore GSK-CORS-001 public webhook, no cookies involved
  return res;
}

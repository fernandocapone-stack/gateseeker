import { NextResponse } from 'next/server';

export async function GET() {
  // gateseeker-ignore GSK-CORS-001
  return new NextResponse('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
}

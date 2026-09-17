import { NextRequest } from 'next/server';
import { readSearchLog } from '@/lib/recap/searchLog';

export const dynamic = 'force-dynamic';

/** Recent recap-search log entries (which tiers ran, which tier won). */
export async function GET(req: NextRequest) {
  const raw = parseInt(req.nextUrl.searchParams.get('days') ?? '7', 10);
  const days = Math.min(30, Math.max(1, Number.isFinite(raw) ? raw : 7));
  const log = await readSearchLog(days);
  return new Response(JSON.stringify({ days: log }), {
    headers: { 'content-type': 'application/json' },
  });
}

import { NextResponse } from 'next/server';
import { listFixtures, loadFixture } from '@/lib/recap/fixtures';

export const dynamic = 'force-dynamic';

/**
 * GET /api/recap/fixtures -> { fixtures: FixtureMeta[] }
 * GET /api/recap/fixtures?slug=<slug> -> full fixture (for opening the dialog)
 */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug');
  if (slug) {
    const fixture = await loadFixture(slug);
    if (!fixture) return NextResponse.json({ error: 'unknown fixture' }, { status: 404 });
    return NextResponse.json(fixture);
  }
  return NextResponse.json({ fixtures: await listFixtures() });
}

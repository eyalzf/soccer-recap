import Link from 'next/link';
import { LEAGUES, NATIONAL_COMPETITIONS } from '@/lib/leagues';
import CandidatesClient from './CandidatesClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ערוצים מועמדים למאגר' };

export default function CandidatesPage() {
  const leagueHe: Record<string, string> = Object.fromEntries([
    ...LEAGUES.map((l) => [l.slug, l.hebrewName]),
    ...NATIONAL_COMPETITIONS.map((l) => [l.slug, l.hebrewName]),
  ]);
  return (
    <div className="app">
      <div className="topbar">
        <h1>ערוצים מועמדים למאגר</h1>
        <Link href="/searchlog" className="refresh-btn">
          חזרה ליומן
        </Link>
      </div>
      <CandidatesClient leagueHe={leagueHe} />
    </div>
  );
}

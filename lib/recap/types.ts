export type SourceKind = 'youtube' | 'sport1' | 'sport5' | 'one';

export interface RawCandidate {
  id: string;
  title: string;
  url: string;
  source: SourceKind;
  videoId?: string;
  thumbnail?: string;
  /** ISO datetime */
  publishedAt?: string;
  durationSec?: number;
  /** YouTube status.embeddable. undefined = unknown (fail open). */
  embeddable?: boolean;
  channelName?: string;
  channelHandle?: string;
  lang: 'he' | 'en';
}

export interface RankedCandidate extends RawCandidate {
  score: number;
}

export interface GameInput {
  home: string;
  away: string;
  /** ISO datetime of the game */
  dateISO: string;
  league: string;
  homeScore: number | null;
  awayScore: number | null;
}

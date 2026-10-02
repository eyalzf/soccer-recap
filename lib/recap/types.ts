export type SourceKind = 'youtube' | 'sport1' | 'sport5' | 'one';

export interface RawCandidate {
  id: string;
  title: string;
  url: string;
  source: SourceKind;
  videoId?: string;
  /**
   * Direct iframe embed URL for non-YouTube sources whose player supports
   * embedding (Sport1's Walla player). When set, the UI renders an inline
   * player instead of an "open at source" link. No JS API exists for this
   * player, so resume/progress tracking does not apply (watched-on-select
   * still records the game view, as with every source).
   */
  embedUrl?: string;
  thumbnail?: string;
  /** ISO datetime */
  publishedAt?: string;
  durationSec?: number;
  /** YouTube status.embeddable. undefined = unknown (fail open). */
  embeddable?: boolean;
  /** YouTube snippet.defaultAudioLanguage (fallback defaultLanguage). undefined = untagged (fail open). */
  audioLang?: string;
  /**
   * Uploader geo-blocked this video in Israel (from
   * contentDetails.regionRestriction). undefined = unknown (fail open).
   */
  blockedInIL?: boolean;
  channelName?: string;
  channelHandle?: string;
  /** YouTube channel ID of the uploader (set on search ingestion). */
  channelId?: string;
  /** Ingested from a curated bulk channel (uploads playlist scan). */
  bulk?: boolean;
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

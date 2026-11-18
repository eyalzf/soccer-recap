'use client';

import { useEffect, useRef } from 'react';

interface Props {
  homeBadge: string | null;
  awayBadge: string | null;
  homeHe: string;
  awayHe: string;
  /** National-team game: badges are flags, drawn rounded (option B). */
  national?: boolean;
}

/**
 * Generated thumbnail: a composite of the two clubs' crests.
 *
 * CRITICAL identity rule: the crest mapping follows TEAM IDENTITY, never
 * visual side. In this RTL layout the HOME team is rendered on the RIGHT
 * and the AWAY team on the LEFT. The slots below are bound to team roles
 * (HOME_SLOT <- home team, AWAY_SLOT <- away team); do not "mirror" them.
 */
export default function CompositeThumb({ homeBadge, awayBadge, homeHe, awayHe, national }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 480;
    const H = 270;
    canvas.width = W;
    canvas.height = H;

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#16223d');
    grad.addColorStop(1, '#0b1226');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const load = (src: string | null): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        if (!src) {
          resolve(null);
          return;
        }
        const img = new Image();
        // No crossOrigin attribute: neither image CDN sends CORS headers,
        // and the canvas is display-only (pixels are never read back),
        // so canvas tainting is harmless. With crossOrigin='anonymous'
        // the loads fail and no crest ever renders.
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    // Team-identity slots: home team on the right (RTL first), away on the left.
    const HOME_SLOT = { x: W * 0.72, label: homeHe, fallback: homeHe };
    const AWAY_SLOT = { x: W * 0.28, label: awayHe, fallback: awayHe };

    Promise.all([load(homeBadge), load(awayBadge)]).then(([homeImg, awayImg]) => {
      // Team name under the crest, word-wrapped onto at most two
      // centered lines (user refinement 2026-10-28): a long name must
      // never be horizontally squished across the center divider or
      // into the other team's half. The font steps down until the
      // wrapped lines fit the slot width; fillText's maxWidth stays
      // as a final guard for a single over-long word.
      const drawLabel = (label: string, cx: number) => {
        const MAXW = 196;
        const LINE_H = 26;
        const CENTER_Y = 205;
        ctx.fillStyle = '#dbe3f4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let size = 22;
        let lines: string[] = [];
        while (size >= 16) {
          ctx.font = `bold ${size}px sans-serif`;
          lines = [];
          let cur = '';
          for (const w of label.split(' ')) {
            const t = cur ? `${cur} ${w}` : w;
            if (ctx.measureText(t).width <= MAXW || !cur) cur = t;
            else {
              lines.push(cur);
              cur = w;
            }
          }
          if (cur) lines.push(cur);
          if (
            lines.length <= 2 &&
            lines.every((l) => ctx.measureText(l).width <= MAXW)
          )
            break;
          size -= 2;
        }
        if (lines.length > 2) lines = [lines[0], lines.slice(1).join(' ')];
        lines.forEach((l, i) => {
          const y = CENTER_Y + (i - (lines.length - 1) / 2) * LINE_H;
          ctx.fillText(l, cx, y, MAXW);
        });
      };

      // Rounded-rect path (manual arcs: no ctx.roundRect dependency).
      const traceRoundRect = (x: number, y: number, w: number, h: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      };

      const drawCrest = (
        img: HTMLImageElement | null,
        slot: { x: number; label: string; fallback: string }
      ) => {
        const size = 120;
        if (img) {
          const ratio = Math.min(size / img.width, size / img.height);
          const w = img.width * ratio;
          const h = img.height * ratio;
          const x = slot.x - w / 2;
          const y = 100 - h / 2;
          if (national) {
            // Flags only (option B, 2026-11-18): rounded corners, a thin
            // light border and a soft drop shadow. Club crests keep the
            // plain draw below — their transparent, irregular shapes
            // must never be clipped into a rectangle.
            const r = 14;
            ctx.save();
            traceRoundRect(x, y, w, h, r);
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 14;
            ctx.shadowOffsetY = 5;
            ctx.fillStyle = '#000';
            ctx.fill();
            ctx.restore();
            ctx.save();
            traceRoundRect(x, y, w, h, r);
            ctx.clip();
            ctx.drawImage(img, x, y, w, h);
            ctx.restore();
            traceRoundRect(x, y, w, h, r);
            ctx.strokeStyle = 'rgba(255,255,255,0.30)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          } else {
            ctx.drawImage(img, x, y, w, h);
          }
        } else {
          ctx.fillStyle = '#2a3a5c';
          ctx.beginPath();
          ctx.arc(slot.x, 100, 50, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f2f5fb';
          ctx.font = 'bold 42px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(slot.fallback.slice(0, 1), slot.x, 102);
        }
        drawLabel(slot.label, slot.x);
      };

      // Identity-explicit draw calls: home crest -> HOME_SLOT, away crest -> AWAY_SLOT.
      drawCrest(homeImg, HOME_SLOT);
      drawCrest(awayImg, AWAY_SLOT);

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(W / 2 - 1, 40, 2, 150);
    });
  }, [homeBadge, awayBadge, homeHe, awayHe, national]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

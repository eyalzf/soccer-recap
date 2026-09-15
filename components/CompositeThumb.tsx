'use client';

import { useEffect, useRef } from 'react';

interface Props {
  homeBadge: string | null;
  awayBadge: string | null;
  homeHe: string;
  awayHe: string;
}

/**
 * Generated thumbnail: a composite of the two clubs' crests.
 *
 * CRITICAL identity rule: the crest mapping follows TEAM IDENTITY, never
 * visual side. In this RTL layout the HOME team is rendered on the RIGHT
 * and the AWAY team on the LEFT. The slots below are bound to team roles
 * (HOME_SLOT <- home team, AWAY_SLOT <- away team); do not "mirror" them.
 */
export default function CompositeThumb({ homeBadge, awayBadge, homeHe, awayHe }: Props) {
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
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      });

    // Team-identity slots: home team on the right (RTL first), away on the left.
    const HOME_SLOT = { x: W * 0.72, label: homeHe, fallback: homeHe };
    const AWAY_SLOT = { x: W * 0.28, label: awayHe, fallback: awayHe };

    Promise.all([load(homeBadge), load(awayBadge)]).then(([homeImg, awayImg]) => {
      const drawCrest = (
        img: HTMLImageElement | null,
        slot: { x: number; label: string; fallback: string }
      ) => {
        const size = 120;
        if (img) {
          const ratio = Math.min(size / img.width, size / img.height);
          const w = img.width * ratio;
          const h = img.height * ratio;
          ctx.drawImage(img, slot.x - w / 2, 100 - h / 2, w, h);
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
        ctx.fillStyle = '#dbe3f4';
        ctx.font = 'bold 21px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(slot.label, slot.x, 200, 200);
      };

      // Identity-explicit draw calls: home crest -> HOME_SLOT, away crest -> AWAY_SLOT.
      drawCrest(homeImg, HOME_SLOT);
      drawCrest(awayImg, AWAY_SLOT);

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(W / 2 - 1, 40, 2, 150);
    });
  }, [homeBadge, awayBadge, homeHe, awayHe]);

  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} />;
}

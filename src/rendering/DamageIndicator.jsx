import { useEffect, useRef } from 'react';
import GameState from '../game/GameState.js';

const W = 110, H = 170;

/** HP fraction → colour: green (full) → yellow → red (critical). */
function zoneColor(frac) {
  if (frac > 0.66) return '#00ff00';
  if (frac > 0.33) return '#ffff00';
  if (frac > 0)    return '#ff4444';
  return '#440000';
}

/**
 * Armor status panel — left side of the screen. Top-down tank silhouette
 * with each armor zone drawn in its HP colour. Polled per frame.
 */
export default function DamageIndicator({ playerTankRef, gameState }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;
    let rafId;

    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const tank   = playerTankRef.current;
      if (!canvas || !tank) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      const max = tank._armorMaxHP;
      const a   = tank.armor;
      const f   = (z) => (a?.[z] ?? 0) / max;

      // Layout: hull outline centred, zones as thick bars around a core
      const hx = 28, hy = 34, hw = 54, hh = 104; // hull rect
      const t  = 9;                              // zone bar thickness

      ctx.lineWidth = 1;

      // Front (top bar)
      ctx.fillStyle = zoneColor(f('front'));
      ctx.fillRect(hx, hy - t - 2, hw, t);
      // Back (bottom bar)
      ctx.fillStyle = zoneColor(f('back'));
      ctx.fillRect(hx, hy + hh + 2, hw, t);
      // Left side (screen-left bar)
      ctx.fillStyle = zoneColor(f('leftSide'));
      ctx.fillRect(hx - t - 2, hy, t, hh);
      // Right side
      ctx.fillStyle = zoneColor(f('rightSide'));
      ctx.fillRect(hx + hw + 2, hy, t, hh);
      // Top armor (centre block)
      ctx.fillStyle = zoneColor(f('top'));
      ctx.fillRect(hx + 12, hy + 28, hw - 24, hh - 56);

      // Hull outline + barrel to orient the silhouette (front = up)
      ctx.strokeStyle = '#00aa00';
      ctx.strokeRect(hx + 0.5, hy + 0.5, hw, hh);
      ctx.beginPath();
      ctx.moveTo(hx + hw / 2, hy + 28);
      ctx.lineTo(hx + hw / 2, hy - t - 8);
      ctx.stroke();

      // Label + numeric readout of the weakest zone
      ctx.fillStyle = '#00aa00';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ARMOR', W / 2, 14);
      const weakest = Math.min(f('front'), f('back'), f('leftSide'), f('rightSide'), f('top'));
      ctx.fillStyle = zoneColor(weakest);
      ctx.fillText(`${Math.round(weakest * 100)}%`, W / 2, H - 6);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [gameState, playerTankRef]);

  if (gameState !== GameState.PLAYING) return null;

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{
        position: 'absolute',
        left: 14,
        top: '50%',
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
        zIndex: 11,
        opacity: 0.9,
      }}
    />
  );
}

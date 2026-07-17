import { useEffect, useRef, useState } from 'react';
import { TANK } from '../utils/constants.js';
import GameState from '../game/GameState.js';

const GREEN  = '#00ff00';
const DIM    = '#008800';
const YELLOW = '#ffff00';
const GREY   = '#666666';

/**
 * Battlezone-style first-person gunsight overlay.
 * Visible only while the camera is in first-person (pinned) mode.
 *
 * Elements:
 *  - centre reticle with range ticks
 *  - elevation ladder (left) with current barrel elevation marker
 *  - hull-vs-turret orientation dial (bottom centre): the triangle is the
 *    hull facing, the line is where the turret (your view) points
 *  - reload state ring around the reticle
 *  - compass heading + biome readout (top)
 */
export default function GunsightHUD({ playerTankRef, gameManagerRef, gameState }) {
  const canvasRef = useRef(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (gameState !== GameState.PLAYING) { setActive(false); return; }

    let rafId;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      const tank   = playerTankRef.current;
      const pinned = !!tank?.cameraController?.isPinned;
      setActive(pinned);

      const canvas = canvasRef.current;
      if (!canvas || !pinned) return;

      const W = window.innerWidth;
      const H = window.innerHeight;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width  = W;
        canvas.height = H;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;

      ctx.lineWidth   = 1.5;
      ctx.font        = '11px monospace';
      ctx.textAlign   = 'center';

      // ---- Centre reticle ----
      const ready = tank.canFire;
      ctx.strokeStyle = ready ? GREEN : GREY;
      // Main cross
      for (const [x0, y0, x1, y1] of [
        [cx - 46, cy, cx - 12, cy], [cx + 12, cy, cx + 46, cy],
        [cx, cy - 34, cx, cy - 10], [cx, cy + 10, cx, cy + 34],
      ]) {
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      // Centre dot
      ctx.fillStyle = ready ? GREEN : GREY;
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
      // Drop ticks below centre (ballistic reference)
      ctx.strokeStyle = DIM;
      for (let i = 1; i <= 3; i++) {
        const ty = cy + i * 26;
        ctx.beginPath(); ctx.moveTo(cx - 8 - i * 2, ty); ctx.lineTo(cx + 8 + i * 2, ty); ctx.stroke();
      }

      // ---- Reload arc around reticle ----
      if (!ready) {
        const frac = 1 - (tank.reloadTimer / TANK.reloadTime);
        ctx.strokeStyle = YELLOW;
        ctx.beginPath();
        ctx.arc(cx, cy, 58, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
      }

      // ---- Elevation ladder (left side) ----
      const lx = cx - 170;
      const ladderH = 200;
      const minE = TANK.barrel.minElevation;
      const maxE = TANK.barrel.maxElevation;
      ctx.strokeStyle = DIM;
      ctx.beginPath(); ctx.moveTo(lx, cy - ladderH / 2); ctx.lineTo(lx, cy + ladderH / 2); ctx.stroke();
      ctx.fillStyle = DIM;
      ctx.textAlign = 'right';
      for (const deg of [-20, 0, 20, 40, 60]) {
        const rad = deg * Math.PI / 180;
        const t   = (rad - minE) / (maxE - minE);          // 0..1
        const y   = cy + ladderH / 2 - t * ladderH;
        ctx.beginPath(); ctx.moveTo(lx - 6, y); ctx.lineTo(lx + 6, y); ctx.stroke();
        ctx.fillText(String(deg), lx - 10, y + 3);
      }
      // Current elevation marker
      const et = (tank.getViewElevation() - minE) / (maxE - minE);
      const ey = cy + ladderH / 2 - Math.max(0, Math.min(1, et)) * ladderH;
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.moveTo(lx + 8, ey); ctx.lineTo(lx + 16, ey - 5); ctx.lineTo(lx + 16, ey + 5);
      ctx.closePath(); ctx.fill();

      // ---- Hull vs turret dial (bottom centre) ----
      const dx = cx, dy = H - 84, dr = 34;
      ctx.strokeStyle = DIM;
      ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.stroke();
      // Turret (view) is always "up" in this dial; hull triangle rotates
      const rel = -tank.turretAngle; // hull direction relative to view
      const hx  = Math.sin(rel), hy = -Math.cos(rel);
      ctx.fillStyle = GREEN;
      ctx.beginPath();
      ctx.moveTo(dx + hx * dr * 0.9, dy + hy * dr * 0.9);
      ctx.lineTo(dx + Math.sin(rel + 2.6) * dr * 0.45, dy - Math.cos(rel + 2.6) * dr * 0.45);
      ctx.lineTo(dx + Math.sin(rel - 2.6) * dr * 0.45, dy - Math.cos(rel - 2.6) * dr * 0.45);
      ctx.closePath(); ctx.fill();
      // Gun line straight up
      ctx.strokeStyle = YELLOW;
      ctx.beginPath(); ctx.moveTo(dx, dy); ctx.lineTo(dx, dy - dr); ctx.stroke();
      ctx.fillStyle = DIM;
      ctx.textAlign = 'center';
      ctx.fillText('HULL', dx, dy + dr + 14);

      // ---- Compass heading + biome (top centre) ----
      const aimYaw = tank.heading + tank.turretAngle;
      let deg = Math.round((-aimYaw * 180 / Math.PI) % 360);
      if (deg < 0) deg += 360;
      const gm    = gameManagerRef?.current;
      const biome = gm?.terrain?.biomeAt
        ? gm.terrain.biomeAt(tank.position.x, tank.position.z).toUpperCase()
        : '';
      ctx.fillStyle = GREEN;
      ctx.fillText(`HDG ${String(deg).padStart(3, '0')}°`, cx, 40);
      ctx.fillStyle = DIM;
      ctx.fillText(`SECTOR: ${biome}`, cx, 56);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [gameState, playerTankRef, gameManagerRef]);

  if (gameState !== GameState.PLAYING) return null;

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 16,
        display: active ? 'block' : 'none',
      }}
    />
  );
}

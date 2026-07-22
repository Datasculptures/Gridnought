import { useEffect, useRef } from 'react';
import { MINIMAP } from '../utils/constants.js';
import GameState from '../game/GameState.js';

// World units shown across the minimap (player-centred window)
const VIEW_SIZE = MINIMAP.viewSize;
// Terrain bake resolution (upscaled with pixelated rendering — on brand)
const BAKE_RES = 80;
// Seconds between terrain re-bakes as the player moves
const BAKE_INTERVAL = 0.5;

/**
 * Canvas minimap for the infinite world — a moving window centred on the
 * player. Terrain height shading re-bakes every BAKE_INTERVAL seconds from
 * the streaming terrain, so the map scrolls as you explore.
 */
export default function Minimap({
  terrainRef,
  obstacleManagerRef,
  playerTankRef,
  projectileManagerRef,
  gameManagerRef,
  gameState,
}) {
  const canvasRef    = useRef(null);
  const offscreenRef = useRef(null);
  const lastBakeRef  = useRef({ time: 0, x: Infinity, z: Infinity });

  useEffect(() => {
    if (gameState !== GameState.PLAYING && gameState !== GameState.ROUND_END && gameState !== GameState.MENU) return;

    const size = MINIMAP.size;
    let rafId;

    // World → map pixels, relative to the view centre
    const w2m = (w, c) => ((w - c) / VIEW_SIZE + 0.5) * size;

    const bakeTerrain = (terrain, cx, cz) => {
      let offscreen = offscreenRef.current;
      if (!offscreen) {
        offscreen = document.createElement('canvas');
        offscreen.width  = BAKE_RES;
        offscreen.height = BAKE_RES;
        offscreenRef.current = offscreen;
      }
      const bctx    = offscreen.getContext('2d');
      const imgData = bctx.createImageData(BAKE_RES, BAKE_RES);
      for (let py = 0; py < BAKE_RES; py++) {
        for (let px = 0; px < BAKE_RES; px++) {
          const wx  = cx + (px / BAKE_RES - 0.5) * VIEW_SIZE;
          const wz  = cz + (py / BAKE_RES - 0.5) * VIEW_SIZE;
          const h   = terrain.getHeightAt(wx, wz);
          const idx = (py * BAKE_RES + px) * 4;
          if (h < -1.0) {
            // Ravines render as vivid blue channels — the clearest hazard cue
            const d = Math.min(1, (-1.0 - h) / 5);
            imgData.data[idx]     = 0;
            imgData.data[idx + 1] = Math.round(90 - d * 60);
            imgData.data[idx + 2] = Math.round(150 + d * 105);
          } else {
            const t = Math.min(1, Math.max(0, (h + 2) / 16));
            imgData.data[idx]     = 0;
            imgData.data[idx + 1] = Math.round(30 + t * 130);
            imgData.data[idx + 2] = 0;
          }
          imgData.data[idx + 3] = 255;
        }
      }
      bctx.putImageData(imgData, 0, 0);
    };

    const draw = (now) => {
      const canvas = canvasRef.current;
      if (!canvas) { rafId = requestAnimationFrame(draw); return; }
      const ctx     = canvas.getContext('2d');
      const player  = playerTankRef.current;
      const terrain = terrainRef.current;
      const cx = player ? player.position.x : 0;
      const cz = player ? player.position.z : 0;

      // Re-bake terrain window periodically or after teleport-scale moves
      const lb = lastBakeRef.current;
      if (terrain && (now - lb.time > BAKE_INTERVAL * 1000
          || Math.abs(cx - lb.x) > VIEW_SIZE / 4
          || Math.abs(cz - lb.z) > VIEW_SIZE / 4)) {
        bakeTerrain(terrain, cx, cz);
        lastBakeRef.current = { time: now, x: cx, z: cz };
      }

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(0, 0, size, size);

      // Terrain shading — offset by movement since last bake so it scrolls
      if (offscreenRef.current) {
        const dxPix = ((lb.x - cx) / VIEW_SIZE) * size;
        const dzPix = ((lb.z - cz) / VIEW_SIZE) * size;
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 0.65;
        ctx.drawImage(offscreenRef.current, dxPix, dzPix, size, size);
        ctx.globalAlpha = 1.0;
      }

      const inView = (x, z) =>
        Math.abs(x - cx) < VIEW_SIZE / 2 + 8 && Math.abs(z - cz) < VIEW_SIZE / 2 + 8;

      // Obstacles
      const om = obstacleManagerRef.current;
      if (om) {
        ctx.fillStyle = '#00bb00';
        for (const obs of om.getObstacles()) {
          const { center, halfExtents } = obs.obb;
          if (!inView(center.x, center.z)) continue;
          const px = w2m(center.x, cx);
          const py = w2m(center.z, cz);
          const pw = Math.max(2, (halfExtents.x / (VIEW_SIZE / 2)) * size);
          const ph = Math.max(2, (halfExtents.z / (VIEW_SIZE / 2)) * size);
          ctx.fillRect(px - pw, py - ph, pw * 2, ph * 2);
        }
      }

      // Projectiles
      const pm = projectileManagerRef.current;
      if (pm) {
        for (const proj of pm.getActiveProjectiles()) {
          if (!proj.isAlive || !proj.position) continue;
          if (!inView(proj.position.x, proj.position.z)) continue;
          const px = w2m(proj.position.x, cx);
          const py = w2m(proj.position.z, cz);
          const isPlayer = proj.owner === playerTankRef.current;
          ctx.fillStyle = isPlayer ? MINIMAP.projectileColor : MINIMAP.enemyProjectileColor;
          ctx.beginPath();
          ctx.arc(px, py, MINIMAP.projectileRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const gm     = gameManagerRef?.current;
      const drones = (gm?.drones ?? []).filter(d => d.isAlive);

      // Sensor coverage: an enemy shows only when within detectRadius of the
      // player tank OR any live drone.
      const detR2 = MINIMAP.detectRadius * MINIMAP.detectRadius;
      const detected = (x, z) => {
        if (player && ((x - cx) ** 2 + (z - cz) ** 2) <= detR2) return true;
        for (const d of drones) {
          const dp = d.position;
          if ((x - dp.x) ** 2 + (z - dp.z) ** 2 <= detR2) return true;
        }
        return false;
      };

      // Detection rings — player (centred) + each drone
      const ringPx = (MINIMAP.detectRadius / VIEW_SIZE) * size;
      ctx.strokeStyle = 'rgba(68,136,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, ringPx, 0, Math.PI * 2);
      ctx.stroke();
      for (const d of drones) {
        if (!inView(d.position.x, d.position.z)) continue;
        const dx = w2m(d.position.x, cx), dz = w2m(d.position.z, cz);
        ctx.strokeStyle = 'rgba(0,204,255,0.30)';
        ctx.beginPath();
        ctx.arc(dx, dz, ringPx, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Allied armour — reports its own position, always shown
      for (const u of (gm?.allyUnits ?? [])) {
        const t = u.tank;
        if (!t.isAlive || !inView(t.position.x, t.position.z)) continue;
        const ax = w2m(t.position.x, cx), az = w2m(t.position.z, cz);
        const fwd = t.getForwardDirection();
        ctx.fillStyle = MINIMAP.droneColor;
        ctx.beginPath();
        ctx.arc(ax, az, MINIMAP.tankRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = MINIMAP.droneColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax, az);
        ctx.lineTo(ax + fwd.x * MINIMAP.tankRadius * 2.2, az + fwd.z * MINIMAP.tankRadius * 2.2);
        ctx.stroke();
      }

      // Enemy tanks (threat pool) — only inside sensor coverage
      for (const u of (gm?.enemyUnits ?? [])) {
        const enemy = u.tank;
        if (!enemy.isAlive || !inView(enemy.position.x, enemy.position.z)) continue;
        if (!detected(enemy.position.x, enemy.position.z)) continue;
        const px  = w2m(enemy.position.x, cx);
        const py  = w2m(enemy.position.z, cz);
        const fwd = enemy.getForwardDirection();
        ctx.fillStyle = MINIMAP.enemyColor;
        ctx.beginPath();
        ctx.arc(px, py, MINIMAP.tankRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = MINIMAP.enemyColor;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(
          px + fwd.x * MINIMAP.tankRadius * 2.2,
          py + fwd.z * MINIMAP.tankRadius * 2.2,
        );
        ctx.stroke();
      }

      // Registered entities — per-kind styling
      if (gm?.entityManager) {
        for (const e of gm.entityManager.entities) {
          if (!e.isAlive) continue;
          if (e.kind === 'powerup') continue;          // pickups don't show
          if (!inView(e.position.x, e.position.z)) continue;
          // Enemy contacts require sensor coverage; allies and neutral
          // trucks report their own positions and always show
          if (e.faction === 'enemy' && !detected(e.position.x, e.position.z)) continue;

          const px = w2m(e.position.x, cx);
          const py = w2m(e.position.z, cz);

          switch (e.kind) {
            case 'infantry':
              // Allied troopers show in friendly blue, always visible
              ctx.fillStyle = e.isAlly ? MINIMAP.playerColor : MINIMAP.enemyColor;
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.6, 0, Math.PI * 2);
              ctx.fill();
              break;
            case 'minelayer':
              ctx.fillStyle = '#ff9933';
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.8, 0, Math.PI * 2);
              ctx.fill();
              break;
            case 'transport': {
              const s = MINIMAP.tankRadius * 1.7;
              ctx.save();
              ctx.translate(px, py);
              ctx.rotate(Math.atan2(e._dir?.x ?? 0, -(e._dir?.z ?? 1)));
              ctx.strokeStyle = '#ff8866';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(-s, s * 0.6); ctx.lineTo(0, -s); ctx.lineTo(s, s * 0.6);
              ctx.moveTo(-s * 0.6, s * 0.2); ctx.lineTo(s * 0.6, s * 0.2);
              ctx.stroke();
              ctx.restore();
              break;
            }
            case 'truck':
              ctx.fillStyle = '#888888';
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.7, 0, Math.PI * 2);
              ctx.fill();
              break;
            case 'apc':
              ctx.fillStyle = '#ff6666';
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.8, 0, Math.PI * 2);
              ctx.fill();
              break;
            case 'bomber': {
              // Aircraft: red arrowhead pointing along its flight direction
              const s = MINIMAP.tankRadius * 1.5;
              ctx.save();
              ctx.translate(px, py);
              ctx.rotate(Math.atan2(e._dir?.x ?? 0, -(e._dir?.z ?? 1)));
              ctx.strokeStyle = '#ff4444';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(-s, s);
              ctx.lineTo(0, -s);
              ctx.lineTo(s, s);
              ctx.stroke();
              ctx.restore();
              break;
            }
            case 'turret': {
              // Immobile emplacement: red hollow square
              const s = MINIMAP.tankRadius * 0.9;
              ctx.strokeStyle = '#ff4444';
              ctx.lineWidth = 1.5;
              ctx.strokeRect(px - s, py - s, s * 2, s * 2);
              break;
            }
            case 'building': {
              // Enemy HQ: filled red square with a cross
              const s = MINIMAP.tankRadius * 1.4;
              ctx.fillStyle = '#ff3333';
              ctx.fillRect(px - s, py - s, s * 2, s * 2);
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(px - s, py); ctx.lineTo(px + s, py);
              ctx.moveTo(px, py - s); ctx.lineTo(px, py + s);
              ctx.stroke();
              break;
            }
            case 'jammer':
              ctx.strokeStyle = '#ff2222';
              ctx.lineWidth   = 1.5;
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.8, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = '#ff2222';
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.35, 0, Math.PI * 2);
              ctx.fill();
              break;
            default:
              ctx.fillStyle = '#aaaaaa';
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.6, 0, Math.PI * 2);
              ctx.fill();
          }
        }
      }

      // Friendly drones — cyan diamonds
      for (const d of drones) {
        if (!inView(d.position.x, d.position.z)) continue;
        const px = w2m(d.position.x, cx), py = w2m(d.position.z, cz);
        const s = MINIMAP.tankRadius * 0.8;
        ctx.fillStyle = MINIMAP.droneColor;
        ctx.beginPath();
        ctx.moveTo(px, py - s); ctx.lineTo(px + s, py);
        ctx.lineTo(px, py + s); ctx.lineTo(px - s, py);
        ctx.closePath();
        ctx.fill();
      }

      // Player tank — always centred
      if (player && player.isAlive) {
        const px  = size / 2;
        const py  = size / 2;
        const fwd = player.getForwardDirection();
        ctx.fillStyle = MINIMAP.playerColor;
        ctx.beginPath();
        ctx.arc(px, py, MINIMAP.tankRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = MINIMAP.playerColor;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(
          px + fwd.x * MINIMAP.tankRadius * 2.2,
          py + fwd.z * MINIMAP.tankRadius * 2.2,
        );
        ctx.stroke();
      }

      // Border
      ctx.strokeStyle = MINIMAP.borderColor;
      ctx.lineWidth   = 1;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [gameState, terrainRef, obstacleManagerRef, playerTankRef, projectileManagerRef, gameManagerRef]);

  if (gameState !== GameState.PLAYING && gameState !== GameState.ROUND_END && gameState !== GameState.MENU) return null;

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP.size}
      height={MINIMAP.size}
      style={{
        position: 'absolute',
        bottom: MINIMAP.padding,
        right: MINIMAP.padding,
        width: MINIMAP.size,
        height: MINIMAP.size,
        pointerEvents: 'none',
        zIndex: 10,
        imageRendering: 'pixelated',
      }}
    />
  );
}

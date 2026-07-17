import { useEffect, useRef } from 'react';
import { MINIMAP, INFANTRY } from '../utils/constants.js';
import GameState from '../game/GameState.js';

// World units shown across the minimap (player-centred window)
const VIEW_SIZE = 220;
// Terrain bake resolution (upscaled with pixelated rendering — on brand)
const BAKE_RES = 80;
// Seconds between terrain re-bakes as the player moves
const BAKE_INTERVAL = 0.5;

/**
 * Returns true if either the player tank or the drone has an unobstructed
 * line of sight to (tx, ty, tz) through obstacles.
 */
function hasLOS(om, player, drone, tx, ty, tz) {
  if (!om) return true; // no obstacle manager → always visible
  const py = player ? (player.position.y + 0.85) : 0;
  if (player && om.hasLineOfSight(
    player.position.x, py, player.position.z, tx, ty, tz,
  )) return true;
  if (drone && drone.isAlive && om.hasLineOfSight(
    drone.position.x, drone.position.y, drone.position.z, tx, ty, tz,
  )) return true;
  return false;
}

/**
 * Canvas minimap for the infinite world — a moving window centred on the
 * player. Terrain height shading re-bakes every BAKE_INTERVAL seconds from
 * the streaming terrain, so the map scrolls as you explore.
 */
export default function Minimap({
  terrainRef,
  obstacleManagerRef,
  playerTankRef,
  enemyTankRef,
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
          // Below-zero (rivers) shade toward blue-black; hills toward green
          const t   = Math.min(1, Math.max(0, (h + 2) / 16));
          const idx = (py * BAKE_RES + px) * 4;
          imgData.data[idx]     = 0;
          imgData.data[idx + 1] = Math.round(30 + t * 130);
          imgData.data[idx + 2] = h < -1.5 ? 60 : 0;
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

      const gm    = gameManagerRef?.current;
      const drone = gm?.drone ?? null;

      // Enemy tank — only if player or drone has LOS
      const enemy = enemyTankRef.current;
      if (enemy && enemy.isAlive && inView(enemy.position.x, enemy.position.z)) {
        const ety = enemy.position.y + 0.85;
        if (hasLOS(om, player, drone, enemy.position.x, ety, enemy.position.z)) {
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
      }

      // Registered entities — per-kind styling
      if (gm?.entityManager) {
        for (const e of gm.entityManager.entities) {
          if (!e.isAlive) continue;
          if (!inView(e.position.x, e.position.z)) continue;

          // Infantry only show when the player or drone has line of sight
          if (e.kind === 'infantry') {
            const iy = e.position.y + INFANTRY.hitYOffset;
            if (!hasLOS(om, player, drone, e.position.x, iy, e.position.z)) continue;
          }

          const px = w2m(e.position.x, cx);
          const py = w2m(e.position.z, cz);

          switch (e.kind) {
            case 'infantry':
              ctx.fillStyle = MINIMAP.enemyColor;
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.6, 0, Math.PI * 2);
              ctx.fill();
              break;
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
  }, [gameState, terrainRef, obstacleManagerRef, playerTankRef, enemyTankRef, projectileManagerRef, gameManagerRef]);

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

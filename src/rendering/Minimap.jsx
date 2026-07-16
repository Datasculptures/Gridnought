import { useEffect, useRef } from 'react';
import { MINIMAP, WORLD_SIZE, INFANTRY, TRUCK, APC } from '../utils/constants.js';
import GameState from '../game/GameState.js';

/** Convert a world-space coordinate to a minimap canvas pixel. */
function worldToMap(w, size) {
  return ((w / WORLD_SIZE) + 0.5) * size;
}

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
 * Canvas-based minimap rendered via a private RAF loop.
 * Terrain is pre-rendered to an offscreen canvas whenever the game enters
 * PLAYING state (catches both first start and terrain regen on Play Again).
 *
 * Props:
 *   terrainRef           React ref to current Terrain instance
 *   obstacleManagerRef   React ref to ObstacleManager
 *   playerTankRef        React ref to player Tank
 *   enemyTankRef         React ref to enemy Tank
 *   projectileManagerRef React ref to ProjectileManager
 *   gameManagerRef       React ref to GameManager (for infantry + drone)
 *   gameState            current GameState string
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

  // Pre-render terrain heightmap to offscreen canvas each time PLAYING or MENU starts.
  useEffect(() => {
    if (gameState !== GameState.PLAYING && gameState !== GameState.MENU) return;
    const terrain = terrainRef.current;
    if (!terrain) return;

    const size      = MINIMAP.size;
    const offscreen = document.createElement('canvas');
    offscreen.width  = size;
    offscreen.height = size;
    const ctx     = offscreen.getContext('2d');
    const imgData = ctx.createImageData(size, size);

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const wx  = (px / size - 0.5) * WORLD_SIZE;
        const wz  = (py / size - 0.5) * WORLD_SIZE;
        const h   = terrain.getHeightAt(wx, wz);
        const t   = Math.min(1, Math.max(0, (h + 2) / 16));
        const g   = Math.round(30 + t * 130);
        const idx = (py * size + px) * 4;
        imgData.data[idx]     = 0;
        imgData.data[idx + 1] = g;
        imgData.data[idx + 2] = 0;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    offscreenRef.current = offscreen;
  }, [gameState, terrainRef]);

  // Animated draw loop — runs during MENU, PLAYING and ROUND_END.
  useEffect(() => {
    if (gameState !== GameState.PLAYING && gameState !== GameState.ROUND_END && gameState !== GameState.MENU) return;

    const size = MINIMAP.size;
    let rafId;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) { rafId = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(0, 0, size, size);

      // Terrain heightmap
      if (offscreenRef.current) {
        ctx.globalAlpha = 0.65;
        ctx.drawImage(offscreenRef.current, 0, 0);
        ctx.globalAlpha = 1.0;
      }

      // Obstacles — filled rectangles sized from each OBB's half-extents
      const om = obstacleManagerRef.current;
      if (om) {
        ctx.fillStyle = '#00bb00';
        for (const obs of om.getObstacles()) {
          const { center, halfExtents } = obs.obb;
          const px = worldToMap(center.x, size);
          const py = worldToMap(center.z, size);
          const pw = Math.max(2, (halfExtents.x / (WORLD_SIZE / 2)) * size);
          const ph = Math.max(2, (halfExtents.z / (WORLD_SIZE / 2)) * size);
          ctx.fillRect(px - pw, py - ph, pw * 2, ph * 2);
        }
      }

      // Projectiles
      const pm = projectileManagerRef.current;
      if (pm) {
        for (const proj of pm.getActiveProjectiles()) {
          if (!proj.isAlive || !proj.position) continue;
          const px = worldToMap(proj.position.x, size);
          const py = worldToMap(proj.position.z, size);
          const isPlayer = proj.owner === playerTankRef.current;
          ctx.fillStyle = isPlayer ? MINIMAP.projectileColor : MINIMAP.enemyProjectileColor;
          ctx.beginPath();
          ctx.arc(px, py, MINIMAP.projectileRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const player = playerTankRef.current;
      const gm     = gameManagerRef?.current;
      const drone  = gm?.drone ?? null;

      // Enemy tank — only if player or drone has LOS
      const enemy = enemyTankRef.current;
      if (enemy && enemy.isAlive) {
        const ety = enemy.position.y + 0.85;
        if (hasLOS(om, player, drone, enemy.position.x, ety, enemy.position.z)) {
          const px  = worldToMap(enemy.position.x, size);
          const py  = worldToMap(enemy.position.z, size);
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

          // Infantry only show when the player or drone has line of sight
          if (e.kind === 'infantry') {
            const iy = e.position.y + INFANTRY.hitYOffset;
            if (!hasLOS(om, player, drone, e.position.x, iy, e.position.z)) continue;
          }

          const px = worldToMap(e.position.x, size);
          const py = worldToMap(e.position.z, size);

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
              // Bright red with a ring to distinguish from APCs
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
              // Unknown kinds: neutral grey dot so new units are still visible
              ctx.fillStyle = '#aaaaaa';
              ctx.beginPath();
              ctx.arc(px, py, MINIMAP.tankRadius * 0.6, 0, Math.PI * 2);
              ctx.fill();
          }
        }
      }

      // Player tank (always visible)
      if (player && player.isAlive) {
        const px  = worldToMap(player.position.x, size);
        const py  = worldToMap(player.position.z, size);
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

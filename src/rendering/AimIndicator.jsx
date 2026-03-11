import { useEffect, useRef } from 'react';
import { AIM } from '../utils/constants.js';
import GameState from '../game/GameState.js';

/**
 * Canvas-based crosshair that follows the mouse cursor.
 * - Colour: yellow when player can fire, grey while reloading.
 * - Positioned via RAF loop to avoid React overhead at 60fps.
 * - The game canvas sets cursor:none during PLAYING so the browser
 *   cursor is hidden and only this crosshair is visible.
 */
export default function AimIndicator({ playerTankRef, gameState }) {
  const canvasRef = useRef(null);
  const mouseRef  = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  // Track raw mouse position
  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;
    const onMove = (e) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [gameState]);

  // Draw crosshair each frame, update canvas position to follow mouse
  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;

    const { crosshairSize: s, crosshairGap: g, crosshairThickness: th } = AIM;
    // Canvas is large enough to contain all four arms + centre gap
    const totalSize = (s + g) * 2;
    const cx        = totalSize / 2;
    const cy        = totalSize / 2;

    let rafId;
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) { rafId = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d');

      // Position canvas so its centre tracks the mouse
      const { x, y } = mouseRef.current;
      canvas.style.left = `${x - cx}px`;
      canvas.style.top  = `${y - cy}px`;

      const tank  = playerTankRef.current;
      const ready = tank ? tank.canFire : true;
      const color = ready ? AIM.readyColor : AIM.reloadingColor;

      ctx.clearRect(0, 0, totalSize, totalSize);
      ctx.strokeStyle = color;
      ctx.lineWidth   = th;
      ctx.lineCap     = 'square';

      // Horizontal left arm
      ctx.beginPath();
      ctx.moveTo(cx - s - g, cy);
      ctx.lineTo(cx - g,     cy);
      ctx.stroke();

      // Horizontal right arm
      ctx.beginPath();
      ctx.moveTo(cx + g, cy);
      ctx.lineTo(cx + s + g, cy);
      ctx.stroke();

      // Vertical top arm
      ctx.beginPath();
      ctx.moveTo(cx, cy - s - g);
      ctx.lineTo(cx, cy - g);
      ctx.stroke();

      // Vertical bottom arm
      ctx.beginPath();
      ctx.moveTo(cx, cy + g);
      ctx.lineTo(cx, cy + s + g);
      ctx.stroke();

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [gameState, playerTankRef]);

  if (gameState !== GameState.PLAYING) return null;

  const totalSize = (AIM.crosshairSize + AIM.crosshairGap) * 2;

  return (
    <canvas
      ref={canvasRef}
      width={totalSize}
      height={totalSize}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: totalSize,
        height: totalSize,
        pointerEvents: 'none',
        zIndex: 15,
      }}
    />
  );
}

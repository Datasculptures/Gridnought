import { useEffect, useRef } from 'react';
import GameState from '../game/GameState.js';
import { TANK } from '../utils/constants.js';

// Canvas layout constants
const W  = 95;   // canvas width
const H  = 90;   // canvas height
const PX = 14;   // pivot X (breech)
const PY = 78;   // pivot Y (breech)
const R  = 58;   // arc radius (px)

export default function ElevationIndicator({ playerTankRef, gameState }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw() {
      rafRef.current = requestAnimationFrame(draw);

      ctx.clearRect(0, 0, W, H);

      // Dark background panel
      ctx.fillStyle = 'rgba(0, 18, 0, 0.72)';
      ctx.fillRect(0, 0, W, H);

      const tank = playerTankRef?.current;
      const elev = (tank && tank.isAlive) ? tank._elevation : TANK.barrel.defaultElevation;
      const maxE = TANK.barrel.maxElevation;

      // --- Full-range arc (dim, shows possible range) ---
      ctx.beginPath();
      ctx.arc(PX, PY, R, -maxE, 0, false);
      ctx.strokeStyle = '#1d4a1d';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Horizontal baseline
      ctx.beginPath();
      ctx.moveTo(PX, PY);
      ctx.lineTo(PX + R + 5, PY);
      ctx.strokeStyle = '#1d4a1d';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Vertical guide (max elevation line, dim)
      ctx.beginPath();
      ctx.moveTo(PX, PY);
      ctx.lineTo(PX + R * Math.cos(-maxE), PY + R * Math.sin(-maxE));
      ctx.strokeStyle = '#1d4a1d';
      ctx.lineWidth = 1;
      ctx.stroke();

      // --- Tick marks every 15° ---
      const tickStep = Math.PI / 12; // 15°
      ctx.strokeStyle = '#3a8a3a';
      ctx.lineWidth = 1;
      for (let a = 0; a <= maxE + 0.001; a += tickStep) {
        const c = Math.cos(-a);
        const s = Math.sin(-a);
        const major = Math.abs(a % (Math.PI / 6)) < 0.01; // 30° marks are longer
        const inner = major ? R - 6 : R - 3;
        const outer = R + 4;
        ctx.beginPath();
        ctx.moveTo(PX + inner * c, PY + inner * s);
        ctx.lineTo(PX + outer * c, PY + outer * s);
        ctx.stroke();
      }

      // --- Current elevation line (yellow) ---
      ctx.beginPath();
      ctx.moveTo(PX, PY);
      ctx.lineTo(PX + R * Math.cos(-elev), PY + R * Math.sin(-elev));
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Arrowhead at tip
      const tipX = PX + R * Math.cos(-elev);
      const tipY = PY + R * Math.sin(-elev);
      ctx.beginPath();
      ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffff00';
      ctx.fill();

      // Pivot dot
      ctx.beginPath();
      ctx.arc(PX, PY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#88ff88';
      ctx.fill();

      // --- Degree readout ---
      const deg = Math.round(elev * 180 / Math.PI);
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#ffff00';
      ctx.fillText(`${deg}°`, 4, 13);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#88ff88';
      ctx.fillText('ELEV', 4, 24);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [playerTankRef]);

  if (gameState !== GameState.PLAYING) return null;

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      style={{
        position:  'fixed',
        right:     '12px',
        top:       '50%',
        transform: 'translateY(-50%)',
        border:    '1px solid #2a6a2a',
        borderRadius: '4px',
        imageRendering: 'pixelated',
      }}
    />
  );
}

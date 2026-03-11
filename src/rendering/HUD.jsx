import { useEffect, useRef } from 'react';
import { HUD as HUD_CONST } from '../utils/constants.js';
import GameState from '../game/GameState.js';

/**
 * Heads-up display — reload bar (bottom-centre) + score (top-centre).
 * Updates via a private RAF loop with direct DOM style writes to avoid
 * triggering React re-renders at 60 fps.
 *
 * Props:
 *   playerTankRef  React ref to player Tank
 *   gameState      current GameState string
 *   score          { player: number, enemy: number }
 */
export default function HUD({ playerTankRef, gameState, score }) {
  const fillRef = useRef(null);

  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;

    let rafId;
    const tick = () => {
      const tank = playerTankRef.current;
      const bar  = fillRef.current;
      if (tank && bar) {
        const progress = tank.getReloadProgress(); // 0.0 = reloading, 1.0 = ready
        bar.style.width = `${Math.round(progress * HUD_CONST.reloadBarWidth)}px`;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [gameState, playerTankRef]);

  if (gameState !== GameState.PLAYING) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {/* Score — top centre */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'monospace',
          fontSize: 13,
          letterSpacing: 2,
          color: '#ffffff',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: '#4488ff' }}>PLAYER</span>
        {` ${score.player} — ${score.enemy} `}
        <span style={{ color: '#ff4444' }}>ENEMY</span>
      </div>

      {/* Reload bar — bottom centre */}
      <div
        style={{
          position: 'absolute',
          bottom: HUD_CONST.reloadBarOffsetBottom,
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        {/* Track */}
        <div
          style={{
            width: HUD_CONST.reloadBarWidth,
            height: HUD_CONST.reloadBarHeight,
            background: HUD_CONST.reloadBarBackground,
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          {/* Fill — width driven directly by the RAF loop */}
          <div
            ref={fillRef}
            style={{
              width: `${HUD_CONST.reloadBarWidth}px`,
              height: '100%',
              background: HUD_CONST.reloadBarColor,
            }}
          />
        </div>
        <div style={{ color: '#ffffff', fontSize: 10, textAlign: 'center', marginTop: 2 }}>
          RELOAD
        </div>
      </div>
    </div>
  );
}

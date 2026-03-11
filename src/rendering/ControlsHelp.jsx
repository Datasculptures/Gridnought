import { useEffect, useState } from 'react';
import { CONTROLS_HELP } from '../utils/constants.js';
import GameState from '../game/GameState.js';

/**
 * Control-hint overlay that fades out automatically after
 * CONTROLS_HELP.displayDuration seconds. Resets to visible each new round.
 */
export default function ControlsHelp({ gameState }) {
  const [visible, setVisible] = useState(true);

  // Reset and schedule fade-out whenever a round starts
  useEffect(() => {
    if (gameState !== GameState.PLAYING) return;
    setVisible(true);
    const timer = setTimeout(
      () => setVisible(false),
      CONTROLS_HELP.displayDuration * 1000,
    );
    return () => clearTimeout(timer);
  }, [gameState]);

  if (gameState !== GameState.PLAYING) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        color: '#00ff00',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.7,
        opacity: visible ? 1 : 0,
        transition: `opacity ${CONTROLS_HELP.fadeDuration}s`,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div>W / S — MOVE</div>
      <div>A / D — TURN</div>
      <div>MOUSE — AIM</div>
      <div>CLICK — FIRE</div>
    </div>
  );
}

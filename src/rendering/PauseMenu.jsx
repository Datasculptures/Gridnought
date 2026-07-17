import GameState from '../game/GameState.js';

/**
 * Pause overlay (Esc). The 3D scene stays frozen behind it.
 * Props:
 *   gameState  current GameState string
 *   onResume() onRestart() onQuit()
 */
export default function PauseMenu({ gameState, onResume, onRestart, onQuit }) {
  if (gameState !== GameState.PAUSED) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 40,
        fontFamily: 'monospace',
        background: 'rgba(0, 0, 0, 0.55)',
      }}
    >
      <div style={{ color: '#00ff00', fontSize: 40, fontWeight: 'bold', letterSpacing: 8, marginBottom: 28 }}>
        PAUSED
      </div>

      <button className="wireframe-btn" onClick={onResume}>RESUME</button>
      <div style={{ height: 10 }} />
      <button className="wireframe-btn" onClick={onRestart}>RESTART RUN</button>
      <div style={{ height: 10 }} />
      <button className="wireframe-btn" onClick={onQuit}>QUIT TO TITLE</button>

      <div style={{ color: '#008800', fontSize: 11, lineHeight: 1.8, marginTop: 32, letterSpacing: 1, textAlign: 'center' }}>
        <div>W / S — MOVE&nbsp;&nbsp;&nbsp;A / D — TURN</div>
        <div>MOUSE — AIM&nbsp;&nbsp;&nbsp;CLICK — FIRE&nbsp;&nbsp;&nbsp;X — MACHINE GUN</div>
        <div>P — TOGGLE VIEW&nbsp;&nbsp;&nbsp;R — RETASK DRONE&nbsp;&nbsp;&nbsp;ESC — PAUSE</div>
      </div>
    </div>
  );
}

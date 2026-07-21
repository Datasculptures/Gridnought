import { useEffect, useState } from 'react';
import GameState from '../game/GameState.js';
import { loadHighScores } from '../utils/highscores.js';

/**
 * The single menu screen — serves as both the title screen (MENU) and the
 * pause screen (PAUSED). RESUME appears only while a run is ongoing.
 *
 * Props:
 *   gameState   current GameState string
 *   onResume()  resume the paused run
 *   onStart()   start a fresh run (also abandons a paused one)
 *   onQuit()    close the application
 */
export default function MenuScreen({ gameState, onResume, onStart, onQuit, onHowTo }) {
  const paused  = gameState === GameState.PAUSED;
  const visible = paused || gameState === GameState.MENU;
  const [scores, setScores] = useState([]);

  useEffect(() => {
    if (visible) setScores(loadHighScores());
  }, [visible]);

  // Enter/Space: resume if paused, otherwise start
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (paused) onResume(); else onStart();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, paused, onResume, onStart]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 30,
        fontFamily: 'monospace',
        background: paused ? 'rgba(0, 0, 0, 0.55)' : 'transparent',
      }}
    >
      <div
        style={{
          color: '#00ff00',
          fontSize: 56,
          fontWeight: 'bold',
          letterSpacing: 10,
          marginBottom: 8,
        }}
      >
        WIREZONE
      </div>
      <div style={{ color: '#00aa00', fontSize: 13, marginBottom: 28 }}>
        {paused ? 'PAUSED' : 'WIREFRAME TANK COMBAT — INFINITE WORLD'}
      </div>

      {paused && (
        <>
          <button className="wireframe-btn" onClick={onResume}>RESUME</button>
          <div style={{ height: 10 }} />
        </>
      )}

      <button className="wireframe-btn" onClick={onStart}>START NEW GAME</button>
      <div style={{ height: 10 }} />
      <button className="wireframe-btn" onClick={onHowTo}>HOW TO / ABOUT</button>
      <div style={{ height: 10 }} />
      <button className="wireframe-btn" onClick={onQuit}>QUIT</button>

      <div style={{ color: '#555', fontSize: 11, marginTop: 10 }}>
        {paused ? 'ENTER / SPACE — RESUME   ESC — RESUME' : 'ENTER / SPACE — START'}
      </div>

      {/* Arcade high-score table */}
      {scores.length > 0 && (
        <div style={{ marginTop: 26, textAlign: 'center' }}>
          <div style={{ color: '#ffff00', fontSize: 12, letterSpacing: 4, marginBottom: 8 }}>
            HIGH SCORES
          </div>
          <div style={{ color: '#00aa00', fontSize: 11, lineHeight: 1.7, letterSpacing: 2, whiteSpace: 'pre' }}>
            {scores.map((s, i) => (
              <div key={i}>
                {String(i + 1).padStart(2, ' ')}. {s.initials.padEnd(3, ' ')}  {String(s.score).padStart(6, '0')}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Controls reference */}
      <div style={{ color: '#006600', fontSize: 10, lineHeight: 1.7, marginTop: 26, letterSpacing: 1, textAlign: 'center' }}>
        <div>W / S — MOVE&nbsp;&nbsp;&nbsp;A / D — TURN&nbsp;&nbsp;&nbsp;MOUSE — AIM&nbsp;&nbsp;&nbsp;CLICK — FIRE</div>
        <div>X — DRONE STRIKE&nbsp;&nbsp;&nbsp;P — TOGGLE VIEW&nbsp;&nbsp;&nbsp;R — RETASK DRONE&nbsp;&nbsp;&nbsp;ESC — PAUSE</div>
      </div>
    </div>
  );
}

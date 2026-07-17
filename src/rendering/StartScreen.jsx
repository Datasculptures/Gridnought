import { useEffect } from 'react';

/**
 * Full-screen title overlay shown while game state is MENU.
 * Props:
 *   onStart() — starts a round in the infinite world
 *   onAreaX() — navigates to the Area X showcase page
 *   visible: boolean
 */
export default function StartScreen({ onStart, onAreaX, visible }) {
  // Keyboard shortcut: Enter or Space starts the game
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, onStart]);

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
      <div style={{ color: '#00aa00', fontSize: 13, marginBottom: 32 }}>
        WIREFRAME TANK COMBAT — INFINITE WORLD
      </div>

      <button className="wireframe-btn" onClick={() => onStart()}>
        START GAME
      </button>
      <div style={{ color: '#555', fontSize: 11, marginTop: 10, marginBottom: 24 }}>
        ENTER / SPACE
      </div>

      <button className="wireframe-btn" onClick={onAreaX}>
        AREA X
      </button>
      <div style={{ color: '#555', fontSize: 11, marginTop: 10 }}>
        UNIT SHOWCASE
      </div>
    </div>
  );
}

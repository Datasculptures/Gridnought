import { useEffect } from 'react';

/**
 * Full-screen overlay shown at ROUND_END.
 *
 * Props:
 *   result      'victory' | 'defeat' | null
 *   onPlayAgain callback
 *   visible     boolean
 *   score       { player: number, enemy: number }
 */
export default function ResultsScreen({ result, onPlayAgain, visible, score }) {
  // Keyboard shortcut: Enter or Space triggers play-again
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onPlayAgain();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, onPlayAgain]);

  if (!visible || !result) return null;

  const isVictory  = result === 'victory';
  const titleColor = isVictory ? '#4488ff' : '#ff4444';
  const titleText  = isVictory ? 'VICTORY' : 'DEFEAT';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
        fontFamily: 'monospace',
      }}
    >
      <div
        style={{
          color: titleColor,
          fontSize: 52,
          fontWeight: 'bold',
          marginBottom: 16,
          letterSpacing: 6,
        }}
      >
        {titleText}
      </div>

      {/* Score tally */}
      {score && (
        <div
          style={{
            fontSize: 14,
            letterSpacing: 3,
            color: '#ffffff',
            marginBottom: 28,
          }}
        >
          <span style={{ color: '#4488ff' }}>PLAYER</span>
          {` ${score.player} — ${score.enemy} `}
          <span style={{ color: '#ff4444' }}>ENEMY</span>
        </div>
      )}

      <button className="wireframe-btn" onClick={onPlayAgain}>
        PLAY AGAIN
      </button>
      <div style={{ color: '#555', fontSize: 11, marginTop: 12 }}>
        ENTER / SPACE
      </div>
    </div>
  );
}

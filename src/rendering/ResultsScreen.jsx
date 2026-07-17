import { useEffect, useRef, useState } from 'react';
import { loadHighScores, qualifiesForHighScore, addHighScore } from '../utils/highscores.js';

/**
 * Full-screen overlay shown at ROUND_END (endless mode: player defeat).
 * Shows the final score; if it makes the top-10 the player enters three
 * initials, arcade style, before the table is displayed.
 *
 * Props:
 *   result      'defeat' | null
 *   onPlayAgain callback
 *   visible     boolean
 *   points      final arcade score
 */
export default function ResultsScreen({ result, onPlayAgain, visible, points = 0 }) {
  const [initials, setInitials]   = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [scores, setScores]       = useState([]);
  const inputRef = useRef(null);

  const qualifies = visible && !submitted && qualifiesForHighScore(points);

  // Reset entry state each time the screen appears
  useEffect(() => {
    if (!visible) return;
    setInitials('');
    setSubmitted(false);
    setScores(loadHighScores());
  }, [visible]);

  useEffect(() => {
    if (qualifies) inputRef.current?.focus();
  }, [qualifies]);

  // Enter/Space → play again (only once initials are dealt with)
  useEffect(() => {
    if (!visible || qualifies) return;
    const handleKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onPlayAgain();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, qualifies, onPlayAgain]);

  if (!visible || !result) return null;

  const submitInitials = () => {
    setScores(addHighScore(initials || '???', points));
    setSubmitted(true);
  };

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
          color: '#ff4444',
          fontSize: 52,
          fontWeight: 'bold',
          marginBottom: 12,
          letterSpacing: 6,
        }}
      >
        GAME OVER
      </div>

      <div style={{ fontSize: 16, letterSpacing: 3, color: '#00ff00', marginBottom: 20 }}>
        SCORE {String(points).padStart(6, '0')}
      </div>

      {qualifies ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ color: '#ffff00', fontSize: 13, letterSpacing: 2, marginBottom: 10 }}>
            NEW HIGH SCORE — ENTER YOUR INITIALS
          </div>
          <input
            ref={inputRef}
            value={initials}
            maxLength={3}
            onChange={e => setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') submitInitials(); }}
            style={{
              background: '#000',
              border: '1px solid #00ff00',
              color: '#00ff00',
              fontFamily: 'monospace',
              fontSize: 26,
              letterSpacing: 12,
              textAlign: 'center',
              width: 110,
              padding: '6px 0 6px 12px',
              outline: 'none',
            }}
          />
          <button className="wireframe-btn" style={{ marginTop: 12 }} onClick={submitInitials}>
            OK
          </button>
        </div>
      ) : (
        scores.length > 0 && (
          <div style={{ color: '#00aa00', fontSize: 12, lineHeight: 1.8, marginBottom: 20, letterSpacing: 2 }}>
            {scores.map((s, i) => (
              <div key={i}>
                {String(i + 1).padStart(2, ' ')}. {s.initials.padEnd(3, ' ')}  {String(s.score).padStart(6, '0')}
              </div>
            ))}
          </div>
        )
      )}

      {!qualifies && (
        <>
          <button className="wireframe-btn" onClick={onPlayAgain}>
            PLAY AGAIN
          </button>
          <div style={{ color: '#555', fontSize: 11, marginTop: 12 }}>
            ENTER / SPACE
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { MESSAGES } from '../utils/constants.js';
import GameState from '../game/GameState.js';

let nextId = 1;

/**
 * Bottom-of-screen event message feed ("JAMMING DETECTED", "WE'VE BEEN HIT",
 * drone range warnings, ...). Newest at the bottom; each message fades out
 * after MESSAGES.displayDuration seconds.
 *
 * Props:
 *   gameManagerRef  React ref to GameManager (subscribes to onMessage)
 *   gameState       current GameState string
 */
export default function MessageTicker({ gameManagerRef, gameState }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const gm = gameManagerRef.current;
    if (!gm) return;
    gm.onMessage((text) => {
      const id = nextId++;
      setMessages(prev => [...prev.slice(-(MESSAGES.maxVisible - 1)), { id, text }]);
      setTimeout(() => {
        setMessages(prev => prev.filter(m => m.id !== id));
      }, MESSAGES.displayDuration * 1000);
    });
  }, [gameManagerRef]);

  // Clear leftovers when leaving PLAYING
  useEffect(() => {
    if (gameState !== GameState.PLAYING) setMessages([]);
  }, [gameState]);

  if (gameState !== GameState.PLAYING || messages.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'none',
        zIndex: 12,
        fontFamily: 'monospace',
      }}
    >
      {messages.map(m => (
        <div
          key={m.id}
          style={{
            color: '#00ff00',
            background: 'rgba(0, 0, 0, 0.55)',
            border: '1px solid rgba(0, 255, 0, 0.35)',
            fontSize: 12,
            letterSpacing: 2,
            padding: '3px 12px',
            whiteSpace: 'nowrap',
            animation: 'wz-msg-in 0.15s ease-out',
          }}
        >
          {m.text}
        </div>
      ))}
    </div>
  );
}

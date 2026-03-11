import { useEffect, useState } from 'react';

const MAP_OPTIONS = [
  { value: 'random',        label: 'RANDOM MAP' },
  { value: 'hills',         label: 'HILLS' },
  { value: 'city',          label: 'CITY' },
  { value: 'river',         label: 'RIVER' },
  { value: 'military_base', label: 'MILITARY BASE' },
  { value: 'crowded_city',  label: 'CROWDED CITY' },
  { value: 'valley',        label: 'VALLEY' },
  { value: 'desert',        label: 'DESERT' },
  { value: 'fortress',      label: 'FORTRESS' },
];

/**
 * Full-screen title overlay shown while game state is MENU.
 * Props:
 *   onStart(mapType: string) — called with the selected map type or 'random'
 *   onAreaX()               — navigates to the Area X showcase page
 *   visible: boolean
 */
export default function StartScreen({ onStart, onAreaX, visible }) {
  const [selectedMap, setSelectedMap] = useState('random');

  // Keyboard shortcut: Enter or Space starts the game with the current selection
  useEffect(() => {
    if (!visible) return;
    const handleKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart(selectedMap);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible, onStart, selectedMap]);

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
        WIREFRAME TANK COMBAT
      </div>

      {/* Map type selector */}
      <select
        className="wireframe-select"
        value={selectedMap}
        onChange={e => setSelectedMap(e.target.value)}
      >
        {MAP_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      <button className="wireframe-btn" onClick={() => onStart(selectedMap)}>
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

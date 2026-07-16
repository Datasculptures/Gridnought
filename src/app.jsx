import { useEffect, useRef, useState } from 'react';
import { GameManager } from './game/GameManager.js';
import GameState from './game/GameState.js';
import HUD from './rendering/HUD.jsx';
import StartScreen from './rendering/StartScreen.jsx';
import ResultsScreen from './rendering/ResultsScreen.jsx';
import Minimap from './rendering/Minimap.jsx';
import AimIndicator from './rendering/AimIndicator.jsx';
import ControlsHelp from './rendering/ControlsHelp.jsx';
import ElevationIndicator from './rendering/ElevationIndicator.jsx';
import AreaX from './rendering/AreaX.jsx';
import './App.css';

export default function App() {
  const canvasRef            = useRef(null);
  const managerRef           = useRef(null);
  const playerTankRef        = useRef(null);
  const enemyTankRef         = useRef(null);
  const terrainRef           = useRef(null);
  const obstacleManagerRef   = useRef(null);
  const projectileManagerRef = useRef(null);
  const gameManagerRef       = useRef(null);

  const [gameState,  setGameState]  = useState(GameState.MENU);
  const [gameResult, setGameResult] = useState(null);
  const [score,      setScore]      = useState({ player: 0, enemy: 0 });
  const [view,       setView]       = useState('game'); // 'game' | 'areax'

  useEffect(() => {
    const gm = new GameManager();
    gm.init(canvasRef.current);

    gm.onStateChange(setGameState);

    gm.onRoundEnd((result) => {
      setGameResult(result);
      setScore(prev => ({
        player: prev.player + (result === 'victory' ? 1 : 0),
        enemy:  prev.enemy  + (result === 'defeat'  ? 1 : 0),
      }));
    });

    gm.start();

    // Dev-only debug handle for console inspection
    if (import.meta.env.DEV) window.__gm = gm;

    managerRef.current           = gm;
    playerTankRef.current        = gm.playerTank;
    enemyTankRef.current         = gm.enemyTank;
    terrainRef.current           = gm.terrain;
    obstacleManagerRef.current   = gm.obstacleManager;
    projectileManagerRef.current = gm.projectileManager;
    gameManagerRef.current       = gm;

    return () => {
      gm.dispose();
      playerTankRef.current        = null;
      enemyTankRef.current         = null;
      terrainRef.current           = null;
      obstacleManagerRef.current   = null;
      projectileManagerRef.current = null;
    };
  }, []);

  const handleStart = (mapType = 'random') => {
    const gm = managerRef.current;
    if (!gm) return;
    gm.setMapTypePreference(mapType);
    gm.startRound();
    // Update terrain ref — startRound() may have rebuilt the terrain
    terrainRef.current = gm.terrain;
  };

  const handlePlayAgain = () => {
    const gm = managerRef.current;
    setGameResult(null);
    gm?.restartRound();
    // restartRound() calls regenerateTerrain() — update ref so Minimap re-bakes terrain
    if (gm) terrainRef.current = gm.terrain;
  };

  // R key — quick restart from any in-game state
  useEffect(() => {
    const handler = (e) => {
      if (e.code !== 'KeyR') return;
      const gm = managerRef.current;
      if (!gm) return;
      if (gm.state === 'PLAYING' || gm.state === 'ROUND_END') {
        setGameResult(null);
        gm.restartRound();
        terrainRef.current = gm.terrain;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (view === 'areax') {
    return <AreaX onBack={() => setView('game')} />;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ cursor: gameState === GameState.PLAYING ? 'none' : 'default' }}
      />

      <HUD
        playerTankRef={playerTankRef}
        gameState={gameState}
        score={score}
      />

      <Minimap
        terrainRef={terrainRef}
        obstacleManagerRef={obstacleManagerRef}
        playerTankRef={playerTankRef}
        enemyTankRef={enemyTankRef}
        projectileManagerRef={projectileManagerRef}
        gameManagerRef={gameManagerRef}
        gameState={gameState}
      />

      <AimIndicator playerTankRef={playerTankRef} gameState={gameState} />

      <ElevationIndicator playerTankRef={playerTankRef} gameState={gameState} />

      <ControlsHelp gameState={gameState} />

      <StartScreen
        visible={gameState === GameState.MENU}
        onStart={handleStart}
        onAreaX={() => setView('areax')}
      />

      <ResultsScreen
        visible={gameState === GameState.ROUND_END}
        result={gameResult}
        onPlayAgain={handlePlayAgain}
        score={score}
      />
    </>
  );
}

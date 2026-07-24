import { useEffect, useRef, useState } from 'react';
import { GameManager } from './game/GameManager.js';
import GameState from './game/GameState.js';
import HUD from './rendering/HUD.jsx';
import MenuScreen from './rendering/MenuScreen.jsx';
import ResultsScreen from './rendering/ResultsScreen.jsx';
import Minimap from './rendering/Minimap.jsx';
import AimIndicator from './rendering/AimIndicator.jsx';
import GunsightHUD from './rendering/GunsightHUD.jsx';
import ControlsHelp from './rendering/ControlsHelp.jsx';
import ElevationIndicator from './rendering/ElevationIndicator.jsx';
import MessageTicker from './rendering/MessageTicker.jsx';
import DamageIndicator from './rendering/DamageIndicator.jsx';
import HowToPage from './rendering/HowToPage.jsx';
import './App.css';

export default function App() {
  const canvasRef            = useRef(null);
  const managerRef           = useRef(null);
  const playerTankRef        = useRef(null);
  const terrainRef           = useRef(null);
  const obstacleManagerRef   = useRef(null);
  const projectileManagerRef = useRef(null);
  const gameManagerRef       = useRef(null);

  const [gameState,  setGameState]  = useState(GameState.MENU);
  const [gameResult, setGameResult] = useState(null);
  const [points,     setPoints]     = useState(0);
  const [showHowTo,  setShowHowTo]  = useState(false);

  useEffect(() => {
    const gm = new GameManager();
    gm.init(canvasRef.current);

    gm.onStateChange(setGameState);

    gm.onRoundEnd((result) => {
      setGameResult(result);
    });

    gm.onPointsChange(setPoints);

    gm.start();

    // Dev-only debug handle for console inspection
    if (import.meta.env.DEV) window.__gm = gm;

    managerRef.current           = gm;
    playerTankRef.current        = gm.playerTank;
    terrainRef.current           = gm.terrain;
    obstacleManagerRef.current   = gm.obstacleManager;
    projectileManagerRef.current = gm.projectileManager;
    gameManagerRef.current       = gm;

    return () => {
      gm.dispose();
      playerTankRef.current        = null;
      terrainRef.current           = null;
      obstacleManagerRef.current   = null;
      projectileManagerRef.current = null;
    };
  }, []);

  // Begins a fresh run in the chosen chassis. From the pause screen this
  // abandons the current run. The player instance is rebuilt on a chassis
  // swap, so the refs the HUD/minimap read must be refreshed.
  const beginRun = (vehicle) => {
    const gm = managerRef.current;
    if (!gm) return;
    if (gm.state === 'PAUSED') gm.restartRound(vehicle);
    else gm.startRound(vehicle);
    terrainRef.current    = gm.terrain;
    playerTankRef.current = gm.playerTank;
  };

  const handleStart     = () => beginRun('tank');
  const handleStartMech = () => beginRun('mech');

  const handleQuit = () => {
    // Tauri desktop window; falls back to window.close() in a plain browser
    const tauriWin = window.__TAURI__?.window?.getCurrentWindow?.();
    if (tauriWin) {
      // close() can be vetoed; destroy() is the reliable exit
      tauriWin.close().catch(() => tauriWin.destroy());
    } else {
      window.close();
    }
  };

  const handlePlayAgain = () => {
    const gm = managerRef.current;
    setGameResult(null);
    gm?.restartRound();   // keeps the current chassis
    // restartRound() calls regenerateTerrain() — update refs so Minimap re-bakes
    // terrain and the HUD tracks the (possibly rebuilt) player instance
    if (gm) {
      terrainRef.current    = gm.terrain;
      playerTankRef.current = gm.playerTank;
    }
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ cursor: gameState === GameState.PLAYING ? 'none' : 'default' }}
      />

      <HUD
        playerTankRef={playerTankRef}
        gameState={gameState}
        points={points}
      />

      <Minimap
        terrainRef={terrainRef}
        obstacleManagerRef={obstacleManagerRef}
        playerTankRef={playerTankRef}
        projectileManagerRef={projectileManagerRef}
        gameManagerRef={gameManagerRef}
        gameState={gameState}
      />

      <AimIndicator playerTankRef={playerTankRef} gameState={gameState} />

      <GunsightHUD
        playerTankRef={playerTankRef}
        gameManagerRef={gameManagerRef}
        gameState={gameState}
      />

      <ElevationIndicator playerTankRef={playerTankRef} gameState={gameState} />

      <ControlsHelp gameState={gameState} />

      <MessageTicker gameManagerRef={gameManagerRef} gameState={gameState} />

      <DamageIndicator playerTankRef={playerTankRef} gameState={gameState} />

      {/* Hidden while the How To page is open so its hotkeys don't fire */}
      {!showHowTo && (
        <MenuScreen
          gameState={gameState}
          onResume={() => managerRef.current?.resumeGame()}
          onStart={handleStart}
          onStartMech={handleStartMech}
          onQuit={handleQuit}
          onHowTo={() => setShowHowTo(true)}
        />
      )}

      <HowToPage visible={showHowTo} onBack={() => setShowHowTo(false)} />

      <ResultsScreen
        visible={gameState === GameState.ROUND_END}
        result={gameResult}
        onPlayAgain={handlePlayAgain}
        points={points}
      />
    </>
  );
}

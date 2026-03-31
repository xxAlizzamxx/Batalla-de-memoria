import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Brain, Users, Trophy, Timer, Play, UserPlus, LogOut, Shield, Zap, ArrowRight, Skull, LogIn, Eye, RefreshCw, Sparkles, Share2, Flame, Snowflake, Shuffle, Swords, User as UserIcon } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Confetti from "react-confetti";
import { auth, db } from "./firebase";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import { collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from "firebase/firestore";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Player {
  id: string;
  name: string;
  score: number;
  totalScore: number;
  timeSpent: number;
  eliminated: boolean;
  board: Card[];
  combo: number;
  skills: Record<string, number>;
  frozenUntil: number;
  shieldedUntil: number;
}

interface Notification {
  id: number;
  message: string;
  type: "success" | "warning" | "info" | "error";
}

interface Card {
  id: number;
  value: string;
  flipped: boolean;
  matched: boolean;
}

type GameMode = "FFA" | "1V1" | "TEAMS";

interface Team {
  id: string;
  name: string;
  playerIds: string[];
  score: number;
  totalScore: number;
  board: Card[];
  currentTurn: string;
}

interface GameState {
  players: { [id: string]: Player };
  teams?: { [teamId: string]: Team };
  mode: GameMode;
  time: number;
  started: boolean;
  winner: string | null;
  currentRound: number;
  totalRounds: number;
  adminId: string | null;
  status: "WAITING" | "PLAYING" | "ROUND_END" | "TOURNAMENT_END";
  theme: string;
  skin: string;
}

// Sound Utilities
const playMatchSound = () => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.1, ctx.currentTime);
  masterGain.connect(ctx.destination);

  [880, 1320, 1760].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.05);
    g.gain.setValueAtTime(0.5, ctx.currentTime + i * 0.05);
    g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.05 + 0.1);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(ctx.currentTime + i * 0.05);
    osc.stop(ctx.currentTime + i * 0.05 + 0.1);
  });
};

const playMismatchSound = () => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.1, ctx.currentTime);
  masterGain.connect(ctx.destination);

  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(110, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(55, ctx.currentTime + 0.3);
  g.gain.setValueAtTime(0.5, ctx.currentTime);
  g.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  osc.connect(g);
  g.connect(masterGain);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
};

const playVictorySound = () => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98, 2093.00];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.15);
    gain.gain.setValueAtTime(0.1, ctx.currentTime + i * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + i * 0.15);
    osc.stop(ctx.currentTime + i * 0.15 + 0.8);
  });
};

// Background Music Controller
let audioCtx: AudioContext | null = null;
let musicStarted = false;

const startBackgroundMusic = () => {
  if (musicStarted) return;
  musicStarted = true;
  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

  const masterGain = audioCtx.createGain();
  masterGain.gain.setValueAtTime(0.04, audioCtx.currentTime);
  masterGain.connect(audioCtx.destination);

  // Robotic "Computer Hum" Layer
  const createDrone = (freq: number, type: OscillatorType) => {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq * 2, audioCtx.currentTime);
    filter.Q.setValueAtTime(10, audioCtx.currentTime);

    lfo.type = "sine";
    lfo.frequency.setValueAtTime(0.5, audioCtx.currentTime);
    lfoGain.gain.setValueAtTime(100, audioCtx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    osc.connect(filter);
    filter.connect(masterGain);
    osc.start();
  };

  createDrone(40, "sawtooth");
  createDrone(60, "square");

  // Robotic "Data Processing" Beeps
  const createDataBeep = (time: number) => {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    const freq = 400 + Math.random() * 1000;

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.05);

    g.gain.setValueAtTime(0.1, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    osc.connect(g);
    g.connect(masterGain);
    osc.start(time);
    osc.stop(time + 0.05);
  };

  // Rhythmic "Clock" Layer
  const createClock = (time: number) => {
    if (!audioCtx) return;
    const noise = audioCtx.createBufferSource();
    const bufferSize = audioCtx.sampleRate * 0.01;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(5000, time);

    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.05, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.01);

    noise.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    noise.start(time);
  };

  let nextTickTime = audioCtx.currentTime;
  const scheduler = () => {
    if (!audioCtx) return;
    while (nextTickTime < audioCtx.currentTime + 0.1) {
      if (Math.random() > 0.7) createDataBeep(nextTickTime);
      createClock(nextTickTime);
      nextTickTime += 0.25;
    }
    requestAnimationFrame(scheduler);
  };
  scheduler();
};

export default function App() {
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [showCopied, setShowCopied] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [spectatingId, setSpectatingId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>("");
  const [joiningRoom, setJoiningRoom] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [peekActive, setPeekActive] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [matchParticles, setMatchParticles] = useState<{ id: number, x: number, y: number }[]>([]);

  useEffect(() => {
    const int = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(int);
  }, []);

  const addNotification = (message: string, type: "success" | "warning" | "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  };
  const [selectedMode, setSelectedMode] = useState<GameMode>("FFA");

  useEffect(() => {
    // Check for room ID in URL
    const params = new URLSearchParams(window.location.search);
    const rId = params.get("room");
    if (rId) {
      setJoiningRoom(rId);
      setRoomId(rId);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u?.displayName) setName(u.displayName);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "leaderboard"), orderBy("score", "desc"), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLeaderboard(entries);
    });

    // Test connection to Firestore
    const testConnection = async () => {
      try {
        const { getDocFromServer, doc } = await import("firebase/firestore");
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const generateRoomId = () => {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    setRoomId(code);
  };

  const connect = () => {
    if (!name.trim()) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "JOIN", name, roomId: roomId || "LOBBY" }));
      setJoined(true);
      startBackgroundMusic();
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "JOIN_SUCCESS") {
        setMyId(message.id);
        setRoomId(message.roomId);
      } else if (message.type === "GAME_STATE") {
        setGameState(message.state);
        if (message.state.status === "TOURNAMENT_END" && user) {
          const myPlayer = message.state.players[message.id];
          if (myPlayer && myPlayer.totalScore > 0) {
            saveScore(myPlayer.totalScore);
          }
        }
      } else if (message.type === "MATCH_FOUND") {
        playMatchSound();
        if (message.combo && message.combo > 1) {
          addNotification(`¡Combo x${message.combo}!`, "success");
        }
        setMatchParticles(prev => [...prev, { id: Date.now(), x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 }]);
        setTimeout(() => {
          setMatchParticles(prev => prev.slice(1));
        }, 1000);
      } else if (message.type === "MISMATCH") {
        playMismatchSound();
      } else if (message.type === "GAME_OVER") {
        playVictorySound();
      } else if (message.type === "SKILL_GAINED") {
        addNotification(`Obtuviste la habilidad: ${message.skill}`, "success");
      } else if (message.type === "SKILL_ACTIVATED") {
        if (message.skill === "peek") {
          setPeekActive(true);
          setTimeout(() => setPeekActive(false), 1500);
        } else if (message.skill === "freeze" && message.target) {
          addNotification(`Congelaste a ${message.target}`, "info");
        } else if (message.skill === "shuffle" && message.target) {
          addNotification(`Mezclaste a ${message.target}`, "warning");
        }
      } else if (message.type === "FROZEN_BY") {
        addNotification(`¡${message.by} te ha congelado!`, "error");
      } else if (message.type === "SHUFFLED_BY") {
        addNotification(`¡${message.by} mezcló tus cartas!`, "warning");
      }
    };

    setSocket(ws);
  };

  const startGame = () => {
    socket?.send(JSON.stringify({ type: "START_GAME", mode: selectedMode }));
  };

  const nextRound = () => {
    socket?.send(JSON.stringify({ type: "NEXT_ROUND" }));
  };

  const flipCard = (cardId: number) => {
    socket?.send(JSON.stringify({ type: "FLIP_CARD", cardId }));
  };

  const saveScore = async (score: number) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "leaderboard"), {
        userId: user.uid,
        name: user.displayName || "Anonymous",
        score: score,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("Error saving score:", error);
    }
  };

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in:", error);
    }
  };

  const shareRoom = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const playersList = Object.values(gameState?.players || {}) as Player[];
  const activePlayers = playersList.filter(p => !p.eliminated);
  const isAdmin = gameState?.adminId === myId;
  const myPlayer = myId ? gameState?.players[myId] : null;
  const myTeam = myId && gameState?.teams ? (Object.values(gameState.teams) as Team[]).find(t => t.playerIds.includes(myId)) : null;

  const currentMode = gameState?.mode || "FFA";
  const myBoard = currentMode === "TEAMS" && myTeam ? myTeam.board : (myPlayer?.board || []);
  const myMatchedPairs = Math.floor((myBoard.filter(c => c.matched).length || 0) / 2);

  const spectatedPlayer = spectatingId ? gameState?.players[spectatingId] : null;
  const spectatedTeam = spectatingId && gameState?.teams ? (Object.values(gameState.teams) as Team[]).find(t => t.playerIds.includes(spectatingId)) : null;
  const boardToDisplay = spectatedPlayer ? (currentMode === "TEAMS" && spectatedTeam ? spectatedTeam.board : spectatedPlayer.board) : myBoard;

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (gameState?.status === "PLAYING" && myPlayer?.eliminated) {
      const others = playersList.filter(p => !p.eliminated && p.id !== myId);
      if (others.length > 0) {
        if (!spectatingId || !gameState.players[spectatingId] || gameState.players[spectatingId].eliminated) {
          const randomPlayer = others[Math.floor(Math.random() * others.length)];
          setSpectatingId(randomPlayer.id);
        }

        // Auto-rotate every 10 seconds
        interval = setInterval(() => {
          const currentOthers = Object.values(gameState?.players || {}) as Player[];
          const filteredOthers = currentOthers.filter(p => !p.eliminated && p.id !== myId);
          if (filteredOthers.length > 1) {
            const nextIndex = (filteredOthers.findIndex(p => p.id === spectatingId) + 1) % filteredOthers.length;
            setSpectatingId(filteredOthers[nextIndex].id);
          }
        }, 10000);
      }
    } else if (gameState?.status !== "PLAYING") {
      if (spectatingId) setSpectatingId(null);
    }
    return () => clearInterval(interval);
  }, [gameState?.status, myPlayer?.eliminated, playersList.length, spectatingId, myId]);

  if (!joined) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-4 relative overflow-hidden">
        <div className="atmosphere" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full glass-card p-8 shadow-2xl relative z-10"
        >
          <div className="flex flex-col items-center text-center gap-4 mb-10">
            <div className="w-16 h-16 bg-gradient-to-tr from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Brain className="w-10 h-10 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-serif font-bold tracking-tight text-glow">Memory Battle</h1>
              <p className="text-sm text-white/50 mt-1">Desafía tu mente con estilo</p>
            </div>
          </div>

          <div className="space-y-6">
            {!user ? (
              <button
                onClick={signIn}
                className="w-full glass-button p-4 rounded-xl flex items-center justify-center gap-3 group"
              >
                <LogIn className="w-5 h-5 text-purple-400 group-hover:scale-110 transition-transform" />
                <span className="font-medium">Iniciar con Google</span>
              </button>
            ) : (
              <div className="flex items-center gap-4 p-4 glass-card bg-white/5 rounded-xl">
                <img src={user.photoURL || ""} alt="" className="w-10 h-10 rounded-full border-2 border-purple-500/50 shadow-md" referrerPolicy="no-referrer" />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-purple-400 font-bold">Bienvenido</div>
                  <div className="text-sm font-medium truncate">{user.displayName}</div>
                </div>
                <button onClick={() => auth.signOut()} className="p-2 hover:text-pink-500 transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-widest text-white/40 ml-1">Tu Nombre</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Escribe tu nombre..."
                className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all"
                onKeyDown={(e) => e.key === "Enter" && connect()}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-xs font-semibold uppercase tracking-widest text-white/40">Código de Sala</label>
                <button
                  onClick={generateRoomId}
                  className="text-[10px] text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1 font-bold uppercase"
                >
                  <RefreshCw className="w-3 h-3" />
                  Generar Nuevo
                </button>
              </div>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="LOBBY"
                className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all font-mono tracking-widest"
                onKeyDown={(e) => e.key === "Enter" && connect()}
              />
            </div>

            <button
              onClick={connect}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-4 rounded-xl hover:shadow-lg hover:shadow-purple-500/30 transition-all flex items-center justify-center gap-2 group"
            >
              <UserPlus className="w-5 h-5 group-hover:scale-110 transition-transform" />
              ¡Entrar a la Arena!
            </button>

            {leaderboard.length > 0 && (
              <div className="mt-10 space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-400">
                  <Trophy className="w-4 h-4" />
                  Top Jugadores
                </div>
                <div className="space-y-2">
                  {leaderboard.map((entry, i) => (
                    <div key={entry.id} className="flex items-center justify-between p-3 glass-card bg-white/5 rounded-lg border-white/5">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-white/30">#{i + 1}</span>
                        <span className="text-sm font-medium truncate max-w-[120px]">{entry.name}</span>
                      </div>
                      <span className="text-sm font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">{entry.score} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-10 pt-6 border-t border-white/5 text-[10px] text-white/30 flex justify-between uppercase tracking-widest">
            <span>Servidor: Activo</span>
            <span>v1.2.0 Modern</span>
          </div>
        </motion.div>
      </div>
    );
  }

  const getCurrentSkinClass = () => {
    switch (gameState?.skin) {
      case "cyberpunk": return "theme-cyberpunk";
      case "minimalist": return "theme-minimalist";
      case "retro": return "theme-retro";
      default: return "";
    }
  };

  return (
    <div className={cn("min-h-screen bg-[#050505] text-white p-4 md:p-8 relative overflow-hidden transition-colors duration-500", getCurrentSkinClass())}>
      <div className="atmosphere" />

      {/* Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map(n => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 50, scale: 0.9 }}
              className={cn(
                "px-6 py-3 rounded-xl backdrop-blur-md border shadow-2xl text-sm font-bold flex items-center gap-3",
                n.type === "success" ? "bg-green-500/20 border-green-500/50 text-green-200" :
                  n.type === "warning" ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-200" :
                    n.type === "error" ? "bg-blue-500/20 border-blue-500/50 text-blue-200" :
                      "bg-purple-500/20 border-purple-500/50 text-purple-200"
              )}
            >
              {n.type === "success" && <Sparkles className="w-5 h-5 text-green-400" />}
              {n.type === "error" && <Snowflake className="w-5 h-5 text-blue-400" />}
              {n.type === "warning" && <Shuffle className="w-5 h-5 text-yellow-400" />}
              {n.type === "info" && <Brain className="w-5 h-5 text-purple-400" />}
              {n.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {gameState?.status === "TOURNAMENT_END" && <Confetti width={windowSize.width} height={windowSize.height} colors={["#a855f7", "#ec4899", "#3b82f6"]} />}

      <div className="max-w-7xl mx-auto space-y-8 relative z-10">
        {/* Top Bar */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 glass-card p-6 border-white/5">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-tr from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-serif font-bold tracking-tight text-glow">Memory Battle</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-4 py-2 glass-card bg-white/5 text-xs font-bold uppercase tracking-widest text-purple-400">
              Sala: {roomId}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(roomId);
                  setShowCopied(true);
                  setTimeout(() => setShowCopied(false), 2000);
                }}
                className="ml-1 p-1 hover:bg-white/10 rounded-md transition-colors"
                title="Copiar Código"
              >
                <Share2 className="w-3 h-3" />
              </button>
            </div>
            <div className="px-4 py-2 glass-card bg-white/5 text-xs font-bold uppercase tracking-widest text-purple-400">
              Ronda {gameState?.currentRound || 1} / {gameState?.totalRounds || 3}
            </div>
            <button
              onClick={shareRoom}
              className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 px-6 py-2 rounded-xl text-xs font-bold uppercase hover:shadow-lg hover:shadow-purple-500/20 transition-all group"
            >
              <Share2 className="w-4 h-4" />
              {showCopied ? "Enlace Copiado" : "Invitar Amigos"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar: Players */}
          <div className="lg:col-span-1 space-y-6">
            <div className="glass-card p-6 border-white/5">
              <div className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40">
                <Users className="w-4 h-4" />
                {currentMode === "TEAMS" && gameState?.teams ? "Equipos" : "Jugadores en Arena"}
              </div>

              <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                {currentMode === "TEAMS" && gameState?.teams ? (
                  (Object.values(gameState.teams) as Team[]).sort((a, b) => b.totalScore - a.totalScore).map(t => (
                    <div key={t.id} className={cn(
                      "p-3 rounded-xl border transition-all",
                      myTeam?.id === t.id ? "border-purple-500/50 bg-purple-500/10" : "border-white/10 bg-white/5"
                    )}>
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2 text-sm font-bold text-white">
                          <Users className="w-4 h-4 text-purple-400" />
                          {t.name}
                        </div>
                        <div className="text-xs font-black text-purple-400">{t.totalScore} pts</div>
                      </div>
                      <div className="text-[10px] text-white/40 uppercase tracking-widest">
                        {t.playerIds.map(id => gameState.players[id]?.name + (myId === id ? " (Tú)" : "")).join(" & ")}
                      </div>
                    </div>
                  ))
                ) : (
                  playersList.sort((a, b) => b.totalScore - a.totalScore).map(p => (
                    <div key={p.id} className={cn(
                      "p-3 rounded-xl border transition-all flex justify-between items-center",
                      p.eliminated ? "border-white/5 opacity-40 bg-white/2" : "border-white/10 bg-white/5",
                      p.id === myId && "border-purple-500/50 bg-purple-500/10"
                    )}>
                      <div className="flex items-center gap-3 min-w-0">
                        {p.id === gameState?.adminId && <Shield className="w-3 h-3 text-yellow-500" />}
                        {p.eliminated ? <Skull className="w-3 h-3 text-white/30" /> : (p.board.every(c => c.matched) && p.board.length > 0 ? <Trophy className="w-3 h-3 text-yellow-500" /> : <Sparkles className="w-3 h-3 text-purple-400 animate-pulse" />)}
                        <span className="text-sm font-medium truncate">{p.name} {p.id === myId && "(Tú)"}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xs font-bold">{p.totalScore}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {gameState?.status === "WAITING" && isAdmin && (
              <div className="glass-card p-6 mb-6 border-white/5 space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-400 mb-2">
                  <Sparkles className="w-4 h-4" /> Personalizar Arena
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">Temática de Cartas</label>
                  <select
                    value={gameState.theme || "default"}
                    onChange={(e) => socket?.send(JSON.stringify({ type: "CHANGE_THEME", theme: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                  >
                    <option value="default" className="bg-black">😃 Emojis Clásicos</option>
                    <option value="tech" className="bg-black">💻 Tecnología & Cyber</option>
                    <option value="animals" className="bg-black">🦊 Animales Salvajes</option>
                    <option value="abstract" className="bg-black">🔶 Formas y Símbolos</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-white/50">Skin del Tablero</label>
                  <select
                    value={gameState.skin || "default"}
                    onChange={(e) => socket?.send(JSON.stringify({ type: "CHANGE_SKIN", skin: e.target.value }))}
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                  >
                    <option value="default" className="bg-black">🌌 Cosmos Original</option>
                    <option value="cyberpunk" className="bg-black">🌆 Cyberpunk Neón</option>
                    <option value="minimalist" className="bg-black">⬜ Minimalista Oscuro</option>
                    <option value="retro" className="bg-black">👾 Arcade Retro</option>
                  </select>
                </div>
              </div>
            )}

            {gameState?.status === "WAITING" && isAdmin && (
              <div className="space-y-4">
                <div className="text-xs font-bold uppercase tracking-widest text-white/40 mb-2">Modo de Juego</div>
                <div className="grid grid-cols-1 gap-3">
                  {/* Modos de juego */}
                  <button
                    onClick={() => setSelectedMode("FFA")}
                    className={cn("p-4 rounded-xl border transition-all flex items-center gap-3", selectedMode === "FFA" ? "bg-purple-500/20 border-purple-500 shadow-lg shadow-purple-500/20" : "bg-white/5 border-white/10 hover:bg-white/10")}
                  >
                    <div className={cn("p-2 rounded-lg", selectedMode === "FFA" ? "bg-purple-500 text-white" : "bg-white/10 text-white/50")}>
                      <Swords className="w-5 h-5" />
                    </div>
                    <div className="text-left flex-1">
                      <div className="font-bold text-sm">Todos vs Todos</div>
                      <div className="text-[10px] text-white/40 leading-tight">Clásico. Puntos ind.</div>
                    </div>
                  </button>

                  <button
                    onClick={() => setSelectedMode("1V1")}
                    className={cn("p-4 rounded-xl border transition-all flex items-center gap-3", selectedMode === "1V1" ? "bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/20" : "bg-white/5 border-white/10 hover:bg-white/10")}
                  >
                    <div className={cn("p-2 rounded-lg flex items-center gap-1", selectedMode === "1V1" ? "bg-blue-500 text-white" : "bg-white/10 text-white/50")}>
                      <UserIcon className="w-4 h-4" />
                      <span className="text-[10px] font-black italic">VS</span>
                      <UserIcon className="w-4 h-4" />
                    </div>
                    <div className="text-left flex-1">
                      <div className="font-bold text-sm">1 vs 1</div>
                      <div className="text-[10px] text-white/40 leading-tight">Duelo cara a cara (2 jug.)</div>
                    </div>
                  </button>

                  <button
                    onClick={() => setSelectedMode("TEAMS")}
                    className={cn("p-4 rounded-xl border transition-all flex items-center gap-3", selectedMode === "TEAMS" ? "bg-pink-500/20 border-pink-500 shadow-lg shadow-pink-500/20" : "bg-white/5 border-white/10 hover:bg-white/10")}
                  >
                    <div className={cn("p-2 rounded-lg flex items-center gap-1", selectedMode === "TEAMS" ? "bg-pink-500 text-white" : "bg-white/10 text-white/50")}>
                      <Users className="w-4 h-4" />
                      <span className="text-[10px] font-black italic">VS</span>
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="text-left flex-1">
                      <div className="font-bold text-sm">Por Equipos</div>
                      <div className="text-[10px] text-white/40 leading-tight">Pares al azar (4 jug.)</div>
                    </div>
                  </button>
                </div>

                <button
                  onClick={startGame}
                  disabled={
                    (selectedMode === "1V1" && playersList.length !== 2) ||
                    (selectedMode === "TEAMS" && playersList.length !== 4) ||
                    (selectedMode === "FFA" && playersList.length < 1)
                  }
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-5 rounded-2xl hover:shadow-xl hover:shadow-purple-500/30 transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                >
                  <Play className="w-6 h-6" />
                  Iniciar Batalla
                </button>
              </div>
            )}

            {gameState?.status === "WAITING" && !isAdmin && (
              <div className="w-full glass-card p-6 bg-white/5 flex flex-col items-center gap-3 opacity-50 animate-pulse">
                <Brain className="w-8 h-8 text-purple-400" />
                <span className="text-[10px] uppercase tracking-widest text-center font-bold">Esperando que el anfitrión inicie...</span>
              </div>
            )}

            {gameState?.status === "ROUND_END" && isAdmin && gameState.currentRound < gameState.totalRounds && (
              <button
                onClick={nextRound}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-5 rounded-2xl hover:shadow-xl hover:shadow-purple-500/30 transition-all flex items-center justify-center gap-3 animate-pulse"
              >
                <ArrowRight className="w-6 h-6" />
                Siguiente Ronda
              </button>
            )}
          </div>

          {/* Main Game Area */}
          <div className="lg:col-span-3 space-y-6">
            {/* Header Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="glass-card p-4 md:p-6 border-white/5 flex flex-col items-center">
                <Timer className="w-5 h-5 mb-2 text-purple-400" />
                <span className="text-xl md:text-3xl font-bold">{gameState?.time || 0}s</span>
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Tiempo</span>
              </div>
              <div className="glass-card p-4 md:p-6 border-white/5 flex flex-col items-center">
                <Sparkles className="w-5 h-5 mb-2 text-pink-400" />
                <span className="text-xl md:text-3xl font-bold">{myMatchedPairs}</span>
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Parejas</span>
              </div>
              <div className="glass-card p-4 md:p-6 border-white/5 flex flex-col items-center relative overflow-hidden group">
                {myPlayer && myPlayer.combo > 1 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="absolute inset-0 bg-gradient-to-t from-orange-500/20 to-transparent pointer-events-none"
                  />
                )}
                <Flame className={cn("w-5 h-5 mb-2 transition-all", myPlayer && myPlayer.combo > 1 ? "text-orange-500 animate-bounce shadow-orange-500/50" : "text-white/30")} />
                <span className={cn("text-xl md:text-3xl font-bold transition-colors", myPlayer && myPlayer.combo > 1 ? "text-orange-400" : "")}>{myPlayer?.combo || 0}</span>
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">Combo</span>
              </div>
              <div className="glass-card p-4 md:p-6 border-white/5 flex flex-col items-center justify-center text-center">
                <Shield className="w-5 h-5 mb-2 text-blue-400 hidden md:block" />
                <span className="text-xs md:text-sm font-bold uppercase tracking-tight">
                  {myPlayer?.eliminated ? "Eliminado" : (myBoard.every(c => c.matched) && myBoard.length > 0 ? "Completado" : "En Juego")}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold hidden md:block">Estado</span>
              </div>
            </div>

            {/* Skills Bar */}
            {gameState?.status === "PLAYING" && !myPlayer?.eliminated && (
              <div className="flex justify-center gap-2 md:gap-4">
                {[
                  { id: "peek", icon: Eye, label: "Revelar", color: "text-purple-400", bg: "bg-purple-500/20", border: "border-purple-500/50" },
                  { id: "freeze", icon: Snowflake, label: "Congelar", color: "text-blue-400", bg: "bg-blue-500/20", border: "border-blue-500/50" },
                  { id: "shield", icon: Shield, label: "Escudo", color: "text-green-400", bg: "bg-green-500/20", border: "border-green-500/50" },
                  { id: "shuffle", icon: Shuffle, label: "Mezclar", color: "text-yellow-400", bg: "bg-yellow-500/20", border: "border-yellow-500/50" }
                ].map(skill => {
                  const count = myPlayer?.skills?.[skill.id] || 0;
                  const Icon = skill.icon;
                  return (
                    <button
                      key={skill.id}
                      onClick={() => count > 0 && socket?.send(JSON.stringify({ type: "USE_SKILL", skill: skill.id }))}
                      disabled={count <= 0}
                      className={cn(
                        "relative p-3 md:p-4 rounded-2xl flex flex-col items-center gap-1 md:gap-2 transition-all border",
                        count > 0 ? `glass-card hover:scale-105 hover:shadow-lg ${skill.bg} ${skill.border}` : "opacity-40 grayscale bg-white/5 border-white/10"
                      )}
                    >
                      {count > 0 && <div className="absolute -top-2 -right-2 w-5 h-5 md:w-6 md:h-6 rounded-full bg-white text-black text-[10px] md:text-xs font-bold flex items-center justify-center shadow-lg">{count}</div>}
                      <Icon className={cn("w-5 h-5 md:w-6 md:h-6", skill.color)} />
                      <span className="text-[8px] md:text-[10px] font-bold uppercase tracking-widest">{skill.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Game Board */}
            <div className="relative glass-card p-4 md:p-8 border-white/5 min-h-[400px] flex items-center justify-center overflow-hidden">
              <AnimatePresence>
                {matchParticles.map(p => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 1, scale: 0, top: p.y + "%", left: p.x + "%" }}
                    animate={{ opacity: 0, scale: 4, top: (p.y - 20) + "%" }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute z-20 pointer-events-none"
                  >
                    <Sparkles className="w-12 h-12 text-yellow-500 mix-blend-screen" />
                  </motion.div>
                ))}
              </AnimatePresence>

              {gameState?.status === "WAITING" && (
                <div className="text-center space-y-6">
                  <Brain className="w-24 h-24 mx-auto text-purple-500/20 animate-pulse" />
                  <p className="text-2xl font-serif italic text-white/40">Preparando la arena mental...</p>
                </div>
              )}

              {(gameState?.status === "ROUND_END" || gameState?.status === "TOURNAMENT_END") && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 z-10 glass-card bg-black/60 backdrop-blur-2xl flex flex-col items-center justify-center text-center p-6 md:p-12 overflow-y-auto"
                >
                  <Trophy className="w-16 h-16 text-yellow-500 mb-6 animate-bounce" />
                  <h2 className="text-3xl md:text-5xl font-serif font-bold italic mb-4 text-glow">
                    {gameState.status === "TOURNAMENT_END" ? `¡Victoria para ${gameState.winner}!` : `Ronda ${gameState.currentRound} Finalizada`}
                  </h2>

                  {/* Podium */}
                  <div className="w-full max-w-2xl mt-8 mb-10 space-y-8">
                    <div className="flex items-end justify-center gap-4 h-48 mb-12 pt-8">
                      {/* 2nd Place */}
                      {playersList.length > 1 && (
                        <div className="flex flex-col items-center gap-3 w-24">
                          <div className="text-xs font-bold truncate w-full glass-card bg-white/10 px-2 py-1 rounded-lg border-white/20">{playersList.sort((a, b) => b.totalScore - a.totalScore)[1].name}</div>
                          <div className="w-full bg-white/5 border-t-2 border-white/20 h-24 flex items-center justify-center relative group rounded-t-xl">
                            <span className="text-2xl font-bold text-white/20 group-hover:text-white/100 transition-all">2</span>
                          </div>
                        </div>
                      )}

                      {/* 1st Place */}
                      {playersList.length > 0 && (
                        <div className="flex flex-col items-center gap-3 w-32">
                          <Trophy className="w-10 h-10 text-yellow-500 animate-pulse" />
                          <div className="text-sm font-bold truncate w-full glass-card bg-purple-500/20 px-2 py-1 rounded-lg border-purple-500/50">{playersList.sort((a, b) => b.totalScore - a.totalScore)[0].name}</div>
                          <div className="w-full bg-gradient-to-b from-purple-500/20 to-transparent border-t-4 border-purple-500 h-36 flex items-center justify-center relative group rounded-t-xl">
                            <span className="text-5xl font-black text-purple-500/40 group-hover:text-purple-500 transition-all">1</span>
                          </div>
                        </div>
                      )}

                      {/* 3rd Place */}
                      {playersList.length > 2 && (
                        <div className="flex flex-col items-center gap-3 w-24">
                          <div className="text-[10px] font-bold truncate w-full glass-card bg-white/10 px-2 py-1 rounded-lg border-white/20">{playersList.sort((a, b) => b.totalScore - a.totalScore)[2].name}</div>
                          <div className="w-full bg-white/5 border-t-2 border-white/10 h-16 flex items-center justify-center relative group rounded-t-xl">
                            <span className="text-xl font-bold text-white/10 group-hover:text-white/100 transition-all">3</span>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="text-xs font-bold uppercase tracking-widest text-white/30 mb-4">Clasificación General</div>
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                      {playersList.sort((a, b) => b.totalScore - a.totalScore).map((p, i) => (
                        <div key={p.id} className={cn(
                          "flex items-center justify-between p-4 rounded-xl border transition-all",
                          p.eliminated ? "border-white/5 opacity-50 grayscale" : "border-white/10 bg-white/5",
                          i === 0 && !p.eliminated && "bg-purple-500/10 border-purple-500/30",
                        )}>
                          <div className="flex items-center gap-4">
                            <span className="text-xs font-bold text-white/30">#{i + 1}</span>
                            <span className="text-sm font-medium flex items-center gap-2">
                              {p.id === gameState?.adminId && <Shield className="w-3 h-3 text-yellow-500" />}
                              {p.name} {p.id === myId && "(Tú)"}
                              {p.eliminated && <span className="text-[8px] text-pink-500 border border-pink-500/50 px-2 py-0.5 rounded-full">ELIMINADO</span>}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-xs font-bold text-purple-400">{p.totalScore} pts</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {gameState.status === "TOURNAMENT_END" && isAdmin && (
                    <button
                      onClick={startGame}
                      className="bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold px-10 py-4 rounded-2xl hover:shadow-xl hover:shadow-purple-500/30 transition-all uppercase tracking-widest text-sm"
                    >
                      Reiniciar Torneo
                    </button>
                  )}

                  {gameState.status === "ROUND_END" && isAdmin && gameState.currentRound < gameState.totalRounds && (
                    <button
                      onClick={nextRound}
                      className="bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold px-10 py-4 rounded-2xl hover:shadow-xl hover:shadow-purple-500/30 transition-all uppercase tracking-widest flex items-center gap-3 animate-pulse text-sm"
                    >
                      <ArrowRight className="w-5 h-5" />
                      Siguiente Ronda
                    </button>
                  )}

                  {gameState.status === "ROUND_END" && !isAdmin && gameState.currentRound < gameState.totalRounds && (
                    <div className="flex flex-col items-center gap-3 opacity-50 animate-pulse">
                      <Brain className="w-10 h-10 text-purple-400" />
                      <span className="text-sm font-bold uppercase tracking-widest">Esperando al anfitrión...</span>
                    </div>
                  )}
                </motion.div>
              )}

              {gameState?.status === "PLAYING" && (
                <div className={cn(
                  "w-full flex flex-col items-center gap-8 p-4 rounded-3xl transition-all duration-500",
                  myPlayer && myPlayer.frozenUntil > now && "grayscale blur-[2px] pointer-events-none opacity-80",
                  myPlayer && myPlayer.shieldedUntil > now && "ring-4 ring-blue-500/50 shadow-[0_0_40px_rgba(59,130,246,0.3)] bg-blue-500/5"
                )}>
                  <div className="w-full flex flex-col items-center gap-8 relative">

                    {/* 1V1 Opponent Mini Board */}
                    {currentMode === "1V1" && playersList.length === 2 && !myPlayer?.eliminated && (
                      <div className="absolute top-0 right-0 glass-card bg-black/40 border-white/10 p-3 rounded-xl scale-75 origin-top-right shadow-2xl z-20 hidden md:block">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2 truncate max-w-[150px]">
                          Op. {playersList.find(p => p.id !== myId)?.name}
                        </div>
                        <div className="grid grid-cols-4 gap-1 w-32">
                          {playersList.find(p => p.id !== myId)?.board.map((c) => (
                            <div key={c.id} className={cn("aspect-square rounded-sm border", c.matched ? "bg-green-500/50 border-green-500" : c.flipped ? "bg-purple-500/50 border-purple-500" : "bg-white/5 border-white/10")} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* TEAMS Turn Indicator */}
                    {currentMode === "TEAMS" && myTeam && !myPlayer?.eliminated && (
                      <div className={cn("px-6 py-2 rounded-full border shadow-lg transition-all", myTeam.currentTurn === myId ? "bg-purple-500/20 border-purple-500 text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.4)] scale-110" : "bg-white/5 border-white/10 text-white/40")}>
                        <span className="text-sm font-bold uppercase tracking-widest">
                          {myTeam.currentTurn === myId ? "¡Tu Turno!" : "Turno Compañero"}
                        </span>
                      </div>
                    )}

                    {myPlayer?.eliminated && spectatedPlayer && (
                      <div className="flex items-center gap-3 glass-card bg-pink-500/10 border-pink-500/30 px-6 py-3 rounded-full animate-pulse">
                        <Eye className="w-5 h-5 text-pink-400" />
                        <span className="text-xs font-bold uppercase tracking-widest">Observando a: {spectatedPlayer.name}</span>
                        <button
                          onClick={() => {
                            const others = playersList.filter(p => !p.eliminated && p.id !== myId);
                            if (others.length > 0) {
                              const randomPlayer = others[Math.floor(Math.random() * others.length)];
                              setSpectatingId(randomPlayer.id);
                            }
                          }}
                          className="ml-2 p-1.5 hover:bg-white/10 rounded-full transition-colors"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    <div className={cn(
                      "grid gap-3 md:gap-4 w-full mx-auto",
                      boardToDisplay.length <= 16 ? "grid-cols-4 max-w-md" :
                        boardToDisplay.length <= 24 ? "grid-cols-6 max-w-2xl" : "grid-cols-8 max-w-4xl"
                    )}>
                      {boardToDisplay.map((card) => {
                        const reveal = card.flipped || card.matched || (peekActive && boardToDisplay === myBoard);
                        return (
                          <motion.div
                            key={card.id}
                            initial={false}
                            animate={{ rotateY: reveal ? 180 : 0 }}
                            transition={{ type: "spring", stiffness: 260, damping: 20 }}
                            whileHover={!reveal && !myPlayer?.eliminated ? { scale: 1.05, y: -4 } : {}}
                            whileTap={!reveal && !myPlayer?.eliminated ? { scale: 0.95 } : {}}
                            onClick={() => !reveal && !myPlayer?.eliminated && flipCard(card.id)}
                            className="aspect-square cursor-pointer relative preserve-3d"
                          >
                            {/* Front of Card (Hidden) */}
                            <div className={cn(
                              "absolute inset-0 rounded-2xl glass-card bg-white/5 border-white/10 flex items-center justify-center backface-hidden shadow-lg",
                              !reveal && !myPlayer?.eliminated && "hover:border-purple-500/50 hover:bg-purple-500/5"
                            )}>
                              <div className="w-8 h-8 rounded-full border-2 border-white/5 flex items-center justify-center">
                                <Brain className="w-4 h-4 text-white/10" />
                              </div>
                            </div>

                            {/* Back of Card (Revealed) */}
                            <div className={cn(
                              "absolute inset-0 rounded-2xl border-2 border-purple-500 bg-gradient-to-br from-purple-600/30 to-pink-600/30 flex items-center justify-center rotate-y-180 backface-hidden shadow-xl",
                              card.matched && "border-green-500 from-green-500/30 to-emerald-500/30"
                            )}>
                              <span className={cn(
                                "text-white text-glow",
                                boardToDisplay.length > 24 ? "text-xl md:text-2xl" :
                                  boardToDisplay.length > 16 ? "text-2xl md:text-3xl" : "text-4xl md:text-6xl"
                              )}>
                                {card.value}
                              </span>
                            </div>
                          </motion.div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Log */}
            <div className="glass-card p-4 border-white/5 text-[10px] font-bold uppercase tracking-widest flex justify-between items-center text-white/30">
              <div className="flex gap-6">
                <span className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                  Arena Conectada
                </span>
                <span>Latencia: 18ms</span>
              </div>
              <div>
                Memory Battle v1.2.0
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .preserve-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
        .rotate-y-180 { transform: rotateY(180deg); }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
          .theme-cyberpunk {
          background-color: #0b0c10 !important;
          font-family: monospace;
        }
        .theme-cyberpunk h1, .theme-cyberpunk .text-glow {
          color: #0ff !important;
          text-shadow: 0 0 10px #0ff;
        }
        .theme-cyberpunk .glass-card {
          border: 1px solid #0ff !important;
          background: rgba(0, 255, 255, 0.05) !important;
          box-shadow: 0 0 10px rgba(0, 255, 255, 0.1) !important;
        }
        .theme-cyberpunk button.bg-gradient-to-r {
          background: linear-gradient(90deg, #ff00ff, #00ffff) !important;
          color: black !important;
          text-shadow: none !important;
          box-shadow: 0 0 20px rgba(0, 255, 255, 0.5) !important;
        }

        .theme-minimalist {
          background-color: #111 !important;
        }
        .theme-minimalist .glass-card {
           background: transparent !important;
           border: 1px solid rgba(255, 255, 255, 0.1) !important;
           border-radius: 4px !important;
           box-shadow: none !important;
        }
        .theme-minimalist button.bg-gradient-to-r, .theme-minimalist button.bg-gradient-to-tr {
           background: #fff !important;
           color: #000 !important;
           border-radius: 4px !important;
           box-shadow: none !important;
        }
        .theme-minimalist .bg-gradient-to-r, .theme-minimalist .bg-gradient-to-tr {
           background: #fff !important;
           border-radius: 4px !important;
        }
        .theme-minimalist svg.text-white { color: #000 !important; }
        .theme-minimalist .atmosphere { display: none; }
        
        .theme-retro {
          background-color: #282a36 !important;
          font-family: "Courier New", Courier, monospace !important;
          color: #ffb86c !important;
        }
        .theme-retro h1, .theme-retro .text-glow {
          color: #bd93f9 !important;
          text-shadow: 4px 4px 0px rgba(0,0,0,0.5);
        }
        .theme-retro .glass-card {
          border: 4px solid #ffb86c !important;
          border-radius: 0 !important;
          background: #282a36 !important;
          box-shadow: -4px 4px 0px #bd93f9 !important;
        }
        .theme-retro button.bg-gradient-to-r {
          background: #ff79c6 !important;
          border-radius: 0 !important;
          border: 4px solid #bd93f9 !important;
          box-shadow: -4px 4px 0px rgba(0,0,0,0.5) !important;
        }
        .theme-retro .atmosphere { display: none; }
      `}</style>
    </div>
  );
}

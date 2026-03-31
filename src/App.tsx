import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Brain, Users, Trophy, Timer, Play, UserPlus, LogOut, Shield, Zap, ArrowRight, Skull, LogIn, Eye, RefreshCw, Sparkles, Share2, Flame, Snowflake, Shuffle, Swords, User as UserIcon } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Confetti from "react-confetti";
import { auth, db } from "./firebase.ts";
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from "firebase/auth";
import { collection, addDoc, query, orderBy, limit, onSnapshot, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { Player, Card, GameMode, Team, GameState, Notification, ChatMessage, cn } from "./types.ts";
import { startRoundTransaction, checkRoundTimerTransaction, flipCardTransaction, useSkillTransaction, unflipCardsTransaction, resetRoomTransaction } from "./firestoreGameService.ts";

// Sound Utilities
const playMatchSound = () => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.3, ctx.currentTime);
  masterGain.connect(ctx.destination);
  if (ctx.state === 'suspended') ctx.resume();

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
  masterGain.gain.setValueAtTime(0.3, ctx.currentTime);
  masterGain.connect(ctx.destination);
  if (ctx.state === 'suspended') ctx.resume();

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
    gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (ctx.state === 'suspended') ctx.resume();
    osc.start(ctx.currentTime + i * 0.15);
    osc.stop(ctx.currentTime + i * 0.15 + 0.8);
  });
};

// Background Music Controller
// Advanced Audio System with Dynamic Themes
let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let themeNodes: AudioNode[] = [];

const startBackgroundAmbience = (skin: string = "default") => {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
  }

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  // Clear previous theme nodes
  themeNodes.forEach(n => { try { (n as any).stop(); } catch(e){} n.disconnect(); });
  themeNodes = [];

  const time = audioCtx.currentTime;

  const createLayer = (freq: number, type: OscillatorType, gVal: number, filterType: BiquadFilterType = "lowpass") => {
    if (!audioCtx || !masterGain) return;
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const g = audioCtx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq * 1.5, time);
    g.gain.setValueAtTime(gVal, time);

    osc.connect(filter);
    filter.connect(g);
    g.connect(masterGain);
    osc.start();
    themeNodes.push(osc, filter, g);
  };

  switch (skin) {
    case "retro":
      createLayer(110, "square", 0.05);
      createLayer(220, "square", 0.03);
      break;
    case "cyberpunk":
      createLayer(40, "sawtooth", 0.08);
      createLayer(80, "sawtooth", 0.04, "highpass");
      break;
    case "deepsea":
      createLayer(60, "sine", 0.1);
      createLayer(30, "sine", 0.15); // Deep rumble
      break;
    case "inferno":
      createLayer(50, "sawtooth", 0.08);
      createLayer(55, "square", 0.06); // Discordant
      break;
    case "matrix":
      createLayer(150, "square", 0.06);
      createLayer(440, "square", 0.03);
      break;
    default: // Cosmos
      createLayer(55, "sine", 0.1);
      createLayer(110, "sine", 0.08);
      createLayer(440, "sine", 0.04);
      break;
  }

  // Start global scheduler if not already running
  if (!(window as any)._audioSchedulerRunning) {
    (window as any)._audioSchedulerRunning = true;
    let nextTick = audioCtx.currentTime;
    const scheduler = () => {
      if (!audioCtx || !masterGain) return;
      while (nextTick < audioCtx.currentTime + 0.1) {
        // Musical generator per skin
        if (skin === "retro") {
           // Simple Chiptune Arp
           if (Math.random() > 0.7) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "square";
              const notes = [440, 523, 659, 880];
              osc.frequency.setValueAtTime(notes[Math.floor(Math.random()*notes.length)], nextTick);
              g.gain.setValueAtTime(0.02, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.15);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.15);
           }
        } else if (skin === "cyberpunk") {
           // Dark Bass Pulses
           if (Math.random() > 0.9) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(60 + Math.random() * 20, nextTick);
              g.gain.setValueAtTime(0.05, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.8);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.8);
           }
        } else if (skin === "deepsea") {
           // Bubbles & Low Sine
           if (Math.random() > 0.95) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(800 + Math.random() * 1000, nextTick);
              g.gain.setValueAtTime(0.01, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.05);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.05);
           }
        } else if (skin === "inferno") {
           // Fire Crackle (Noise)
           if (Math.random() > 0.8) {
              const bufferSize = audioCtx.sampleRate * 0.1;
              const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
              const data = buffer.getChannelData(0);
              for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
              const node = audioCtx.createBufferSource();
              node.buffer = buffer;
              const g = audioCtx.createGain();
              g.gain.setValueAtTime(0.01, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.1);
              node.connect(g).connect(masterGain);
              node.start(nextTick);
           }
        } else if (skin === "matrix") {
           // Digital Bleeps
           if (Math.random() > 0.85) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(2000 + Math.random() * 4000, nextTick);
              g.gain.setValueAtTime(0.02, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.02);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.02);
           }
        } else {
           // Cosmos (Default Floating Pad)
           if (Math.random() > 0.98) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(100 + Math.random() * 300, nextTick);
              g.gain.setValueAtTime(0.03, nextTick);
              g.gain.linearRampToValueAtTime(0, nextTick + 4);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 4);
           }
        }
        nextTick += 0.15;
      }
      requestAnimationFrame(scheduler);
    };
    scheduler();
  }
};

export default function App() {
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [showCopied, setShowCopied] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [spectatingId, setSpectatingId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string>("");
  const [joiningRoom, setJoiningRoom] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = (message: string, type: "success" | "error" | "info" = "info") => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type: type as any }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 3000);
  };

  const [peekActive, setPeekActive] = useState(false);
  const [isWaitingForUnflip, setIsWaitingForUnflip] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [matchParticles, setMatchParticles] = useState<{ id: number, x: number, y: number }[]>([]);
  const [selectedMode, setSelectedMode] = useState<GameMode>("FFA");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");

  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [activeSkillAnim, setActiveSkillAnim] = useState<string | null>(null);

  useEffect(() => {
    if (gameState?.lastEvent && gameState.lastEvent.id !== lastEventId) {
      setLastEventId(gameState.lastEvent.id);
      if (gameState.lastEvent.type === "SKILL_ACTIVATED") {
         setActiveSkillAnim(gameState.lastEvent.skill.toUpperCase());
         setTimeout(() => setActiveSkillAnim(null), 1000); // Faster
         if (gameState.lastEvent.skill === "peek") {
            setPeekActive(true);
            setTimeout(() => setPeekActive(false), 1500); // Shorter peek
         }
      }
    }
  }, [gameState?.lastEvent, lastEventId]);

  const sendReaction = async (reaction: string) => {
    if (!roomId || !myId) return;
    const roomRef = doc(db, "rooms", roomId);
    await updateDoc(roomRef, {
      [`players.${myId}.lastReaction`]: reaction,
      [`players.${myId}.reactionTime`]: Date.now()
    });
  };

  const emotions = ["😂", "🔥", "😱", "😤", "👋", "💀", "👑", "😈"];

  const isAdmin = gameState?.adminId === myId;
  const playersList = (Object.values(gameState?.players || {}) as Player[]).sort((a,b) => b.totalScore - a.totalScore);
  const myPlayer = myId ? gameState?.players[myId] : null;
  const myTeam = (gameState?.teams && myId) ? (Object.values(gameState.teams) as Team[]).find(t => t.playerIds.includes(myId)) : null;
  const spectatedPlayer = spectatingId ? gameState?.players[spectatingId] : null;
  const currentMode = gameState?.mode || "FFA";
  const spectatedTeam = (gameState?.teams && spectatingId) ? (Object.values(gameState.teams) as Team[]).find(t => t.playerIds.includes(spectatingId)) : null;

  const myBoard = (currentMode === "TEAMS" && myTeam) ? myTeam.board : (myPlayer?.board || []);
  const boardToDisplay = spectatedPlayer ? (currentMode === "TEAMS" && spectatedTeam ? spectatedTeam.board : spectatedPlayer.board) : myBoard;

  const connect = async () => {
    if (!name.trim()) return;
    const computedRoomId = roomId || "LOBBY";
    
    // Crucial: Use persistent UID if logged in, otherwise localStorage guest ID
    let guestId = localStorage.getItem("memory_battle_guest_id");
    if (!guestId) {
      guestId = Math.random().toString(36).substring(7);
      localStorage.setItem("memory_battle_guest_id", guestId);
    }
    const newMyId = user ? user.uid : guestId;
    setMyId(newMyId);
    setRoomId(computedRoomId);
    
    const roomRef = doc(db, "rooms", computedRoomId);

    try {
      const docSnap = await getDoc(roomRef);
      const defaultPlayer: Player = {
        id: newMyId,
        name,
        photoURL: user?.photoURL || null,
        score: 0,
        totalScore: 0,
        timeSpent: 0,
        eliminated: false,
        board: [],
        combo: 0,
        skills: { peek: 0, freeze: 0, shield: 0, shuffle: 0 },
        frozenUntil: 0,
        shieldedUntil: 0,
        theme: "default",
        skin: "default"
      };

      if (!docSnap.exists()) {
        await setDoc(roomRef, {
          players: { [newMyId]: defaultPlayer },
          mode: "FFA",
          time: 50,
          started: false,
          winner: null,
          currentRound: 1,
          totalRounds: 3,
          adminId: newMyId,
          status: "WAITING",
          theme: "default",
          skin: "default",
          messages: []
        });
      } else {
        const data = docSnap.data();
        const updateData: any = {
          [`players.${newMyId}`]: defaultPlayer
        };
        // Takeover admin if previous is gone
        if (!data.adminId || !data.players[data.adminId]) {
          updateData.adminId = newMyId;
        }
        await updateDoc(roomRef, updateData);
      }
      setJoined(true);
    } catch (error) {
      console.error("Error joining:", error);
      setJoined(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser && !name) {
        setName(currentUser.displayName || "");
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (joined && myPlayer?.skin) {
      startBackgroundAmbience(myPlayer.skin);
    }
  }, [joined, myPlayer?.skin]);

  useEffect(() => {
    if (!joined || !roomId || !myId) return;
    const roomRef = doc(db, "rooms", roomId);
    const unsub = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as GameState;
        setGameState(data);
        // Robust auto-reclaim
        const players = Object.keys(data.players || {});
        if ((!data.adminId || !data.players[data.adminId]) && players.includes(myId)) {
           updateDoc(roomRef, { adminId: myId });
        }
      }
    });
    return () => unsub();
  }, [joined, roomId, myId]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (gameState?.status === "PLAYING" && gameState.adminId === myId && roomId) {
      interval = setInterval(() => {
        checkRoundTimerTransaction(roomId);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [gameState?.status, gameState?.adminId, myId, roomId]);

  useEffect(() => {
    if (gameState?.lastEvent) {
      const ev = gameState.lastEvent;
      if (ev.type === "MATCH_FOUND" && ev.playerId === myId) {
        playMatchSound();
        if (ev.combo && ev.combo > 1) {
          addNotification(`¡Combo x${ev.combo}!`, "success");
        }
        setMatchParticles(prev => [...prev, { id: Date.now(), x: Math.random() * 80 + 10, y: Math.random() * 80 + 10 }]);
        setTimeout(() => setMatchParticles(prev => prev.slice(1)), 1000);
        if (ev.skill) {
          addNotification(`Obtuviste la habilidad: ${ev.skill}`, "success");
        }
      } else if (ev.type === "MISMATCH" && ev.playerId === myId) {
        playMismatchSound();
        setIsWaitingForUnflip(true);
        setTimeout(() => {
          if (roomId && myId) {
            unflipCardsTransaction(roomId, myId);
          }
          setIsWaitingForUnflip(false);
        }, 1000);
      }
      // Status notifications
      if (ev.type === "SKILL_ACTIVATED") {
        if (ev.skill === "peek" && ev.playerId === myId) {
          setPeekActive(true);
          setTimeout(() => setPeekActive(false), 2000);
          addNotification(`¡Vistazo activado!`, "info");
        } else if (ev.skill === "freeze" && ev.playerId === myId) {
          addNotification(`Has congelado a un oponente`, "info");
        } else if (ev.skill === "shield" && ev.playerId === myId) {
          addNotification(`¡Escudo activado!`, "success");
        } else if (ev.skill === "shuffle" && ev.playerId === myId) {
           addNotification(`¡Has mezclado el tablero de un oponente!`, "info");
        }

        if (ev.skill === "freeze" && ev.target === myId) {
          addNotification(`¡${ev.by || 'Alguien'} te ha congelado!`, "error");
        }
        if (ev.skill === "shuffle" && ev.target === myId) {
          addNotification(`¡${ev.by || 'Alguien'} mezcló tu tablero!`, "error");
        }
      }
    }
  }, [gameState?.lastEvent?.id]);

  const startGame = () => {
    if (!roomId) return;
    const roomRef = doc(db, "rooms", roomId);
    const startObj: any = { mode: selectedMode };
    if (selectedMode === "TEAMS") {
      const pIds = Object.keys(gameState?.players || {}).sort(() => Math.random() - 0.5);
      startObj.teams = {
        "TEAM_1": { id: "TEAM_1", name: "Equipo Rojo", playerIds: [pIds[0], pIds[1] || pIds[0]], score: 0, totalScore: 0, board: [], currentTurn: pIds[0] },
        "TEAM_2": { id: "TEAM_2", name: "Equipo Azul", playerIds: [pIds[2] || pIds[0], pIds[3] || pIds[0]], score: 0, totalScore: 0, board: [], currentTurn: pIds[2] || pIds[0] }
      };
    }
    updateDoc(roomRef, startObj).then(() => {
      startRoundTransaction(roomId, 1);
    });
  };

  const flipCard = (cardId: number) => {
    if (roomId && myId && !isWaitingForUnflip) {
      flipCardTransaction(roomId, myId, cardId);
    }
  };

  const sendChat = (emotion?: string) => {
    if (!roomId || !myId || (!chatMessage.trim() && !emotion)) return;
    const roomRef = doc(db, "rooms", roomId);
    const newMessage: ChatMessage = {
      id: Math.random().toString(36).substring(7),
      senderId: myId,
      senderName: name,
      text: chatMessage.trim() || "",
      emotion: emotion || "",
      timestamp: Date.now()
    };
    const currentMsgs = gameState?.messages || [];
    updateDoc(roomRef, {
      messages: [...currentMsgs.slice(-15), newMessage]
    });
    setChatMessage("");
  };

  const getCurrentSkinClass = () => {
    const skin = myPlayer?.skin || "default";
    switch (skin) {
      case "cyberpunk": return "theme-cyberpunk";
      case "matrix": return "theme-matrix";
      case "retro": return "theme-retro";
      case "deepsea": return "theme-deepsea";
      case "inferno": return "theme-inferno";
      default: return "";
    }
  };
  const signIn = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { console.error(e); }
  };

  if (!joined) {
    return (
      <div className="min-h-screen bg-[#050505] text-white flex items-center justify-center p-4 relative overflow-hidden">
        <div className="atmosphere" />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full glass-card p-8 shadow-2xl relative z-10">
          <div className="flex flex-col items-center text-center gap-4 mb-10">
            <div className="w-16 h-16 bg-gradient-to-tr from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Brain className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-serif font-bold tracking-tight text-glow">Memory Battle</h1>
          </div>
          <div className="space-y-6">
            {!user ? (
               <button onClick={signIn} className="w-full glass-button p-4 rounded-xl flex items-center justify-center gap-3">
                 <LogIn className="w-5 h-5 text-purple-400" /> Iniciar con Google
               </button>
            ) : (
               <div className="flex items-center gap-4 p-4 glass-card bg-white/5 rounded-xl">
                 <img src={user.photoURL || ""} alt="" className="w-10 h-10 rounded-full border-2 border-purple-500" referrerPolicy="no-referrer" />
                 <div className="flex-1 italic">{user.displayName}</div>
                 <button onClick={() => auth.signOut()}><LogOut className="w-5 h-5 text-white/30 hover:text-white" /></button>
               </div>
            )}
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" className="w-full bg-white/5 border border-white/10 rounded-xl p-4 transition-all focus:border-purple-500/50 outline-none" />
            <div className="relative group">
              <input type="text" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} placeholder="Código Sala" className="w-full bg-white/5 border border-white/10 rounded-xl p-4 font-mono transition-all focus:border-purple-500/50 outline-none" />
              <button onClick={() => setRoomId(Math.random().toString(36).substring(2, 7).toUpperCase())} className="absolute right-4 top-1/2 -translate-y-1/2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 p-2 rounded-lg transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                 <RefreshCw className="w-3 h-3" /> Generar
              </button>
            </div>
            <button onClick={connect} className="w-full bg-gradient-to-r from-purple-600 to-pink-600 font-bold py-4 rounded-xl">Entrar a la Arena</button>
          </div>
        </motion.div>
      </div>
    );
  }


  return (
    <div className={cn("min-h-screen bg-[#050505] text-white p-4 md:p-8 relative transition-colors duration-500", getCurrentSkinClass())}>
      <div className="atmosphere" />
      
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-8 relative z-20">
        <div className="flex items-center gap-3">
           <div className="p-2 bg-purple-500 rounded-lg"><Brain className="w-6 h-6" /></div>
           <h1 className="text-2xl font-serif font-bold">Memory Battle</h1>
        </div>
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2 glass-card bg-white/5 px-4 py-2">
              <span className="text-[10px] font-bold uppercase text-white/30 truncate max-w-16">Sala {roomId}</span>
              <div className="flex gap-1">
                 <button onClick={() => resetRoomTransaction(roomId)} title="Reiniciar Sala" className="p-1 hover:bg-white/10 rounded transition-colors"><RefreshCw className="w-4 h-4 text-white/40" /></button>
                 <button onClick={() => setChatOpen(!chatOpen)} className="p-1 hover:bg-white/10 rounded transition-colors"><Share2 className="w-4 h-4 text-white/40" /></button>
              </div>
           </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar */}
        <div className="w-full lg:w-80 shrink-0 space-y-6">
           {gameState?.status !== "PLAYING" && (
             <div className="glass-card p-6">
                <div className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-4">Jugadores</div>
                <div className="space-y-2">
                   {(playersList as Player[]).map((p: Player) => (
                      <div key={p.id} className="flex items-center gap-3 p-2 bg-white/5 rounded-lg">
                         <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className="w-8 h-8 rounded-full border border-purple-500/30" />
                         <span className="text-sm truncate flex-1">{p.name} {p.id === myId && "(Tú)"}</span>
                         <span className="text-xs font-bold">{p.totalScore}</span>
                         {gameState?.adminId === p.id && <Shield className="w-3 h-3 text-purple-400" />}
                      </div>
                   ))}
                </div>
             </div>
           )}

           {/* Personalization for ALL */}
           {gameState?.status !== "PLAYING" && (
             <div className="glass-card p-6 space-y-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-purple-400 opacity-50">Personalización</div>
                <div className="space-y-3">
                   <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-white/20">Fichas</label>
                      <select value={myPlayer?.theme} onChange={(e) => updateDoc(doc(db, "rooms", roomId!), { [`players.${myId}.theme`]: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-purple-500">
                         <option value="default">Emojis Mixtos</option>
                         <option value="tech">Tecnología / Sci-Fi</option>
                         <option value="animals">Mundo Animal</option>
                         <option value="abstract">Formas Geométricas</option>
                         <option value="fantasy">Fantasía / Rol</option>
                         <option value="food">Comida / Chef</option>
                         <option value="space">Galaxia / Espacio</option>
                      </select>
                   </div>
                   <div className="space-y-1">
                      <label className="text-[9px] uppercase font-bold text-white/20">Interfaz</label>
                      <select value={myPlayer?.skin} onChange={(e) => updateDoc(doc(db, "rooms", roomId!), { [`players.${myId}.skin`]: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none focus:border-purple-500">
                         <option value="default">Diseño Cosmos</option>
                         <option value="retro">Clásico Retro</option>
                         <option value="cyberpunk">Neon Cyberpunk</option>
                         <option value="deepsea">Abismo Marino</option>
                         <option value="inferno">Infierno Ardiente</option>
                         <option value="matrix">Matrix Digital</option>
                      </select>
                   </div>
                </div>
             </div>
           )}
                        {gameState?.status === "WAITING" && (
               <div className="space-y-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-400/50 mb-2">Preparar Partida</div>
                  <div className="glass-card bg-white/5 p-4 space-y-4">
                     <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-white/30">Modo de Juego</label>
                        <select value={selectedMode} onChange={(e) => setSelectedMode(e.target.value as GameMode)} className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:ring-2 ring-purple-500/50 outline-none transition-all">
                           <option value="FFA">Todos vs Todos</option>
                           <option value="1V1">1 vs 1</option>
                           <option value="TEAMS">Por Equipos</option>
                        </select>
                        <button 
                         onClick={startGame} 
                         className={cn(
                           "w-full font-black py-4 rounded-xl shadow-lg hover:scale-[1.02] active:scale-95 transition-all text-sm tracking-widest uppercase mt-4",
                           myPlayer?.skin === "retro" ? "bg-white text-black border-4 border-black" :
                           myPlayer?.skin === "cyberpunk" ? "bg-cyan-500 text-black shadow-[0_0_20px_rgba(0,255,255,0.5)]" :
                           myPlayer?.skin === "deepsea" ? "bg-blue-600 text-white" :
                           myPlayer?.skin === "inferno" ? "bg-orange-600 text-black" :
                           myPlayer?.skin === "matrix" ? "bg-green-600 text-black" :
                           "bg-gradient-to-r from-purple-600 to-pink-600 text-white"
                         )}
                      >
                        Iniciar Batalla
                      </button>
                      {!isAdmin && <div className="text-[9px] text-center opacity-30 italic mt-2">Cualquier jugador puede iniciar la partida</div>}
                     </div>
                  </div>
               </div>
            )}

            {gameState?.status === "PLAYING" && (
               <div className={cn(
                   "glass-card p-4 text-center border-b-4",
                   myPlayer?.skin === "retro" ? "border-white" :
                   myPlayer?.skin === "cyberpunk" ? "border-cyan-500" :
                   myPlayer?.skin === "inferno" ? "border-orange-600" :
                   myPlayer?.skin === "matrix" ? "border-green-600" :
                   "border-purple-500"
                )}>
                  <div className="text-[10px] font-black uppercase tracking-widest text-green-400 opacity-50">Batalla en Curso</div>
               </div>
            )}
         </div>

         {/* Main Area */}
         <div className="flex-1 flex flex-col items-center">
           {/* Stats Grid */}
           {gameState?.status === "PLAYING" && (
              <div className="w-full max-w-4xl grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                 {[
                   { label: 'Tiempo', value: `${gameState.time}s`, icon: Timer, color: 'text-purple-400' },
                   { label: 'Parejas', value: myBoard.filter(c => c.matched).length / 2, icon: Brain, color: 'text-pink-400' },
                   { label: 'Combo', value: myPlayer?.combo || 0, icon: Flame, color: 'text-orange-400' },
                   { label: 'Puntos', value: myPlayer?.score || 0, icon: Trophy, color: 'text-yellow-400' }
                 ].map((stat, i) => (
                   <div key={i} className="glass-card bg-white/5 p-4 flex flex-col items-center justify-center text-center group hover:bg-white/10 transition-all border-b-2 border-transparent hover:border-purple-500/50">
                      <stat.icon className={cn("w-5 h-5 mb-2 opacity-50 group-hover:opacity-100 transition-opacity", stat.color)} />
                      <div className="text-2xl font-black tracking-tighter">{stat.value}</div>
                      <div className="text-[10px] uppercase font-bold tracking-[0.2em] opacity-30 group-hover:opacity-60 transition-opacity">{stat.label}</div>
                   </div>
                 ))}
              </div>
           )}
 
           {/* Skills above the board */}
           {gameState?.status === "PLAYING" && (
              <div className="w-full max-w-2xl grid grid-cols-4 gap-2 mb-4 animate-in slide-in-from-top duration-500">
                 {[
                   { id: 'peek', icon: Eye, label: 'Vistazo', color: 'text-blue-400' },
                   { id: 'freeze', icon: Snowflake, label: 'Hielo', color: 'text-cyan-300' },
                   { id: 'shield', icon: Shield, label: 'Escudo', color: 'text-yellow-400' },
                   { id: 'shuffle', icon: Shuffle, label: 'Mezclar', color: 'text-purple-400' }
                 ].map((skill) => (
                   <button 
                     key={skill.id}
                     onClick={() => roomId && myId && useSkillTransaction(roomId, myId, skill.id as any)} 
                     disabled={!myPlayer?.skills[skill.id as keyof typeof myPlayer.skills]} 
                     className="flex flex-col items-center justify-center p-2 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 hover:scale-105 active:scale-95 disabled:opacity-20 transition-all group"
                   >
                     <div className="relative">
                        <skill.icon className={cn("w-5 h-5 mb-1", skill.color)} />
                        {myPlayer?.skills[skill.id as keyof typeof myPlayer.skills]! > 0 && (
                           <div className="absolute -top-2 -right-2 bg-green-500 text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center animate-bounce">
                              {myPlayer?.skills[skill.id as keyof typeof myPlayer.skills]}
                           </div>
                        )}
                     </div>
                     <span className="text-[8px] font-black uppercase tracking-tighter opacity-50">{skill.label}</span>
                   </button>
                 ))}
              </div>
           )}

            <div className={cn("relative w-full flex flex-col lg:flex-row items-start justify-center gap-8 md:gap-12 p-4 min-h-[50vh]", gameState?.status === "PLAYING" ? "lg:justify-between px-8 lg:px-20 mt-[-20px]" : "justify-center")}>
               {/* Profile Left (Only during play) */}
               {gameState?.status === "PLAYING" && (
                 <div className="hidden lg:flex w-32 flex-col items-center gap-4 animate-float">
                     {currentMode === "TEAMS" && myTeam ? (() => {
                        const isBlue = myTeam.name.toLowerCase().includes("azul");
                        const teamColorClass = isBlue ? "from-blue-400 to-blue-600" : "from-pink-400 to-pink-600";
                        const teamBgClass = isBlue ? "bg-blue-900" : "bg-pink-900";
                        const teamTextClass = isBlue ? "text-blue-400" : "text-pink-400";
                        const teamLabelBg = isBlue ? "bg-blue-600" : "bg-pink-600";
                        
                        return (
                          <div className="flex flex-col items-center gap-2">
                            <div className={cn("relative p-0.5 bg-gradient-to-b rounded-full shadow-[0_0_15px_rgba(59,130,246,0.3)]", teamColorClass)}>
                               <div className={cn("w-16 h-16 rounded-full border-2 border-black flex items-center justify-center font-black text-xl", teamBgClass)}>
                                  {myTeam.name[0]}
                               </div>
                               <div className={cn("absolute -bottom-2 left-1/2 -translate-x-1/2 text-[6px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white", teamLabelBg)}>Tu Equipo</div>
                            </div>
                            <div className="flex -space-x-2 mt-1">
                               {myTeam.playerIds.map(pid => (
                                  <img key={pid} src={gameState.players[pid]?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${pid}`} className="w-6 h-6 rounded-full border border-black" />
                               ))}
                            </div>
                            <div className={cn("text-[10px] font-black uppercase tracking-tighter text-center", teamTextClass)}>{myTeam.name}</div>
                          </div>
                        );
                     })() : (
                       <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                          <AnimatePresence>
                             {myPlayer?.lastReaction && String(myPlayer.lastReaction) !== "0" && myPlayer.reactionTime && myPlayer.reactionTime > Date.now() - 3000 && (
                                <motion.div initial={{ scale: 0, y: 0 }} animate={{ scale: 1.5, y: -40 }} exit={{ scale: 0, opacity: 0 }} className="absolute -top-12 left-1/2 -translate-x-1/2 text-4xl z-50">
                                   {myPlayer.lastReaction}
                                </motion.div>
                             )}
                          </AnimatePresence>
                          {myPlayer?.shieldedUntil && myPlayer.shieldedUntil > Date.now() && (
                             <div className="absolute inset-0 bg-yellow-400/20 rounded-full animate-pulse border-4 border-yellow-400/50 shadow-[0_0_30px_rgba(250,204,21,0.5)] z-20 scale-150" />
                          )}
                          <div className={cn("relative p-0.5 bg-gradient-to-b from-blue-400 to-blue-600 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-transform duration-500 z-10", myPlayer?.frozenUntil && myPlayer.frozenUntil > Date.now() ? "grayscale scale-90" : "scale-100")}>
                            <img src={myPlayer?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${myId}`} className="w-16 h-16 rounded-full border-2 border-black" />
                            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-blue-600 text-[6px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white">Tú</div>
                          </div>
                        </div>
                        <div className="text-center">
                           <div className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">{myPlayer?.name}</div>
                           {myPlayer?.shieldedUntil && myPlayer.shieldedUntil > Date.now() && <div className="text-[7px] uppercase font-bold text-yellow-500 flex items-center justify-center gap-1 animate-bounce"><Shield className="w-2 h-2" /> Activo</div>}
                        </div>

                        {/* Reaction Grid */}
                        <div className="grid grid-cols-2 gap-2 bg-white/5 p-2 rounded-2xl border border-white/10 backdrop-blur-sm">
                           {["😂", "😡", "😭", "🎉", "🔥", "🚀", "❤️", "👻"].map(emoji => (
                              <button key={emoji} onClick={() => sendReaction(emoji)} className="w-8 h-8 flex items-center justify-center hover:bg-white/10 rounded-full transition-transform active:scale-90 text-lg">
                                 {emoji}
                              </button>
                           ))}
                        </div>
                      </div>
                    )}
                 </div>
               )}

               {/* Board Area */}
               <div className="flex-1 flex flex-col items-center justify-center px-4">
                  {gameState?.status === "WAITING" && (
                    <div className="text-center py-20 bg-white/2 rounded-[40px] border border-dashed border-white/10 w-full max-w-2xl">
                       <div className="relative inline-block mb-8">
                          <div className="absolute inset-0 bg-purple-500/20 blur-3xl rounded-full animate-pulse" />
                          <Brain className="w-24 h-24 text-purple-500 mx-auto relative z-10" />
                       </div>
                       <div className="font-serif italic text-white/40 text-2xl mb-2">Preparando la arena mental...</div>
                       <div className="text-[10px] uppercase tracking-[0.3em] font-black text-white/10">Esperando el inicio de la batalla de memoria</div>
                    </div>
                  )}
 
                  {gameState?.status === "PLAYING" && (
                     <div 
                         className={cn(
                            "grid gap-1.5 md:gap-2 w-full max-w-[min(95vw,85vh,700px)]",
                            activeSkillAnim === "SHUFFLE" && "animate-bounce"
                         )}
                         style={{ gridTemplateColumns: `repeat(${Math.sqrt(boardToDisplay.length) || 4}, minmax(0, 1fr))` }}
                      >
                        {boardToDisplay.map(c => {
                           const reveal = c.flipped || c.matched || (peekActive && boardToDisplay === myBoard);
                           const isSpectatingTheirBoard = spectatedPlayer && boardToDisplay === spectatedPlayer.board;
                           const isFrozen = (spectatedPlayer || myPlayer)?.frozenUntil && (spectatedPlayer || myPlayer)!.frozenUntil > Date.now();
                           
                           return (
                             <div key={c.id} onClick={() => flipCard(c.id)} className={cn(
                                "aspect-square rounded-lg cursor-pointer transition-all duration-500 relative group preserve-3d shadow-xl", 
                                reveal ? "rotate-y-180" : "bg-white/10 hover:bg-white/20 hover:scale-105 active:scale-95",
                                isFrozen && "opacity-50 grayscale pointer-events-none"
                             )}>
                                <div className={cn(
                                   "absolute inset-0 flex items-center justify-center text-xl md:text-2xl backface-hidden rounded-lg border border-white/5", 
                                   reveal ? "bg-purple-600 shadow-[0_0_15px_rgba(147,51,234,0.4)]" : "bg-white/5 overflow-hidden",
                                   myPlayer?.skin === "retro" && "border-4 border-black border-double",
                                   myPlayer?.skin === "cyberpunk" && reveal && "bg-cyan-500/80 shadow-[0_0_25px_cyan]",
                                   myPlayer?.skin === "inferno" && !reveal && "bg-orange-950/40"
                                )}>
                                   <div className={cn(
                                       reveal ? "scale-100 opacity-100" : "scale-0 opacity-0",
                                       "transition-all duration-500 transform font-serif font-black"
                                   )}>
                                      {c.value}
                                   </div>
                                   {!reveal && (
                                      <div className="absolute inset-0 flex items-center justify-center opacity-20 group-hover:opacity-40 transition-opacity">
                                         {myPlayer?.skin === "retro" ? <div className="text-[10px] font-black line-through">PIXEL</div> : <Brain className="w-6 h-6" />}
                                      </div>
                                   )}
                                   {!reveal && isFrozen && <div className="absolute inset-0 bg-cyan-400/30 flex items-center justify-center backdrop-blur-sm rounded-lg"><Snowflake className="w-full h-full p-2 text-cyan-200 animate-pulse" /></div>}
                                </div>
                                {!reveal && <div className="absolute inset-0 bg-gradient-to-tr from-white/0 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg" />}
                             </div>
                           );
                        })}
                    </div>
                 )}

                 {gameState?.status === "ROUND_END" && (
                    <div className="text-center py-20 p-12 glass-card border-blue-500/50">
                       <Timer className="w-16 h-16 text-blue-400 mx-auto mb-6 opacity-30" />
                       <h2 className="text-3xl font-serif font-black mb-2 uppercase">Fin de la Ronda {gameState.currentRound}</h2>
                       <p className="text-white/40 mb-8 font-mono">Calculando resultados y preparando la siguiente fase...</p>
                       <button onClick={() => roomId && startRoundTransaction(roomId, gameState.currentRound + 1)} className="bg-blue-600 text-white font-black px-10 py-4 rounded-full hover:bg-blue-500 transition-all uppercase tracking-widest text-xs shadow-lg shadow-blue-600/20">
                          Siguiente Ronda
                       </button>
                    </div>
                 )}

                 {gameState?.status === "TOURNAMENT_END" && (
                     <div className="text-center py-20 glass-card bg-white/5 p-12 border-purple-500/50 scale-in">
                        <Trophy className="w-20 h-20 text-yellow-500 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
                        <h2 className="text-4xl font-serif font-black mb-2 uppercase tracking-tight text-glow">Partida Finalizada</h2>
                        <p className="text-white/40 mb-8 font-mono">El ganador ha sido coronado en el salón de la fama.</p>
                        <div className="flex flex-col gap-3 max-w-xs mx-auto">
                           {playersList.slice(0, 3).map((p, i) => (
                              <div key={p.id} className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/5">
                                 <span className="text-2xl font-black text-white/20">{i+1}</span>
                                 <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className="w-10 h-10 rounded-full" />
                                 <div className="flex-1 text-left font-bold truncate">{p.name}</div>
                                 <div className="font-black text-purple-400">{p.totalScore}</div>
                              </div>
                           ))}
                        </div>
                        <button onClick={() => roomId && resetRoomTransaction(roomId)} className="mt-8 bg-white text-black font-black px-8 py-3 rounded-full hover:bg-purple-500 hover:text-white transition-all uppercase tracking-widest text-xs">Volver al Lobby</button>
                     </div>
                 )}
               </div>

               {/* Profile Right */}
               {gameState?.status === "PLAYING" && (
                  <div className="hidden lg:flex w-32 flex-col items-center gap-4 animate-float-delayed">
                    {(currentMode === "1V1" || currentMode === "TEAMS") ? (
                      currentMode === "TEAMS" ? (() => {
                        const rivalTeam = (Object.values(gameState.teams || {}) as Team[]).find(t => t.id !== myTeam?.id);
                        if (!rivalTeam) return null;
                        
                        const isRojo = rivalTeam.name.toLowerCase().includes("rojo");
                        const teamColorClass = isRojo ? "from-pink-400 to-pink-600" : "from-blue-400 to-blue-600";
                        const teamBgClass = isRojo ? "bg-pink-900" : "bg-blue-900";
                        const teamTextClass = isRojo ? "text-pink-400" : "text-blue-400";
                        const teamLabelBg = isRojo ? "bg-pink-600" : "bg-blue-600";

                        return (
                          <div className="flex flex-col items-center gap-2">
                             <div className="relative">
                               <div className={cn("p-0.5 bg-gradient-to-b rounded-full shadow-[0_0_15px_rgba(236,72,153,0.3)]", teamColorClass)}>
                                 <div className={cn("w-16 h-16 rounded-full border-2 border-black flex items-center justify-center font-black text-xl", teamBgClass)}>
                                    {rivalTeam.name[0]}
                                 </div>
                                 <div className={cn("absolute -bottom-2 left-1/2 -translate-x-1/2 text-[6px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white", teamLabelBg)}>Rival</div>
                               </div>
                             </div>
                             <div className="flex -space-x-2 mt-1">
                                {rivalTeam.playerIds.map(pid => (
                                   <img key={pid} src={gameState.players[pid]?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${pid}`} className="w-6 h-6 rounded-full border border-black" />
                                ))}
                             </div>
                             <div className={cn("text-[10px] font-black uppercase tracking-tighter text-center", teamTextClass)}>{rivalTeam.name}</div>
                          </div>
                        );
                      })() : (() => {
                        const rival = playersList.find(p => p.id !== myId);
                        return (
                          <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                               <AnimatePresence>
                                  {rival?.lastReaction && String(rival.lastReaction) !== "0" && rival.reactionTime && rival.reactionTime > Date.now() - 3000 && (
                                     <motion.div initial={{ scale: 0, y: 0 }} animate={{ scale: 1.5, y: -40 }} exit={{ scale: 0, opacity: 0 }} className="absolute -top-12 left-1/2 -translate-x-1/2 text-4xl z-50">
                                        {rival.lastReaction}
                                     </motion.div>
                                  )}
                               </AnimatePresence>
                               <div className={cn("relative p-0.5 bg-gradient-to-b from-pink-400 to-pink-600 rounded-full shadow-[0_0_15px_rgba(236,72,153,0.3)] transition-all duration-500", rival?.frozenUntil && rival.frozenUntil > Date.now() ? "grayscale scale-110" : "")}>
                                 <img src={rival?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=opp`} className="w-16 h-16 rounded-full border-2 border-black" />
                                 <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-pink-600 text-[6px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white">Rival</div>
                               </div>
                            </div>
                            <div className="text-center">
                               <div className="text-[10px] font-black text-pink-400 uppercase tracking-tighter">{rival?.name || "Buscando..."}</div>
                               {rival?.frozenUntil && rival.frozenUntil > Date.now() && <div className="text-[7px] uppercase font-bold text-cyan-300 flex items-center justify-center gap-1 animate-pulse"><Snowflake className="w-2 h-2" /> Congelado</div>}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="w-32" /> // Empty space for FFA balance
                    )}
                  </div>
               )}
            </div>
         </div>

       {/* Skill Animation Overlay */}
       <AnimatePresence>
         {activeSkillAnim && (
           <motion.div 
             initial={{ opacity: 0, scale: 0.5, y: 100 }} 
             animate={{ opacity: 1, scale: 0.8, y: 0 }} 
             exit={{ opacity: 0, scale: 1.5, y: -100 }} 
             className="fixed top-20 left-1/2 -translate-x-1/2 pointer-events-none z-[100] text-3xl font-black italic uppercase text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.5)] flex items-center gap-4 bg-white/10 px-8 py-4 rounded-full backdrop-blur-xl border border-white/20"
           >
              <Zap className="w-8 h-8 text-yellow-400 animate-pulse" />
              <div>{activeSkillAnim === "PEEK" ? "VISTAZO" : activeSkillAnim === "FREEZE" ? "CONGELADO" : activeSkillAnim === "SHIELD" ? "ESCUDO" : "MEZCLA"}!</div>
           </motion.div>
         )}
       </AnimatePresence>

      {/* Notifications */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2">
        {notifications.map(n => (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} key={n.id} className={cn("px-6 py-3 rounded-xl shadow-lg border backdrop-blur-md", n.type === "success" ? "bg-green-500/20 border-green-500/50 text-green-200" : n.type === "error" ? "bg-red-500/20 border-red-500/50 text-red-200" : "bg-blue-500/20 border-blue-500/50 text-blue-200")}>
            {n.message}
          </motion.div>
        ))}
      </div>

      {/* Chat */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }} className="fixed bottom-24 right-8 w-72 h-96 glass-card bg-black flex flex-col z-50">
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {gameState?.messages?.map(m => (
                <div key={m.id} className={cn("text-xs p-2 rounded-lg", m.senderId === myId ? "bg-purple-600 ml-8" : "bg-white/10 mr-8")}>
                  <div className="font-bold opacity-50">{m.senderName}</div>
                  <div>{m.text} {m.emotion}</div>
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-white/10 flex gap-2">
               <input value={chatMessage} onChange={(e) => setChatMessage(e.target.value)} onKeyDown={e => e.key === "Enter" && sendChat()} className="flex-1 bg-white/5 p-2 rounded text-xs" placeholder="Mensaje..." />
               <button onClick={() => sendChat("🔥")} className="text-lg">🔥</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .rotate-y-180 { transform: rotateY(180deg); transition: transform 0.5s; }
        .atmosphere { position: fixed; inset: 0; z-index: -1; background: radial-gradient(circle at 50% 50%, rgba(124,58,237,0.1), transparent); overflow: hidden; }
        .glass-card { background: rgba(255,255,255,0.05); backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1); border-radius: 20px; }
        
        /* Themes Enhanced */
        .theme-retro { background: #1a1a1a !important; color: #ff00ff !important; font-family: 'Courier New', monospace !important; }
        .theme-retro .glass-card { border: 4px solid #fff !important; border-image: repeating-linear-gradient(45deg, #000, #000 5px, #fff 5px, #fff 10px) 10 !important; }
        
        .theme-cyberpunk { background: #050005 !important; color: #00ffff !important; overflow: hidden; }
        .theme-cyberpunk .atmosphere { background: linear-gradient(to bottom, #050005, #1a0033) !important; }
        .theme-cyberpunk .atmosphere::after { content: ""; position: absolute; inset: 0; background-image: radial-gradient(#0ff 1px, transparent 1px); background-size: 40px 40px; opacity: 0.1; }

        .theme-deepsea { background: #000b1a !important; color: #00e5ff !important; }
        .theme-deepsea .atmosphere { background: radial-gradient(circle at bottom, #004d66 0%, #000b1a 100%) !important; }
        .theme-deepsea .atmosphere::before { content: "🫧"; position: absolute; width: 100%; height: 100%; top: 0; animation: bubbles 20s linear infinite; opacity: 0.1; font-size: 30px; }
        @keyframes bubbles { from { transform: translateY(100vh); } to { transform: translateY(-100vh); } }

        .theme-inferno { background: #0d0000 !important; color: #ff4500 !important; }
        .theme-inferno .atmosphere { background: radial-gradient(circle at center, #350000 0%, #0d0000 100%) !important; }
        .theme-inferno .atmosphere::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent, #ff450010); animation: haze 3s ease-in-out infinite alternate; }
        @keyframes haze { from { opacity: 0.3; } to { opacity: 0.6; } }

        .theme-matrix { background: #000 !important; color: #00ff41 !important; }
        .theme-matrix .atmosphere::after { content: ""; position: absolute; inset: 0; background: linear-gradient(transparent 50%, rgba(0, 50, 0, 0.1) 50%); background-size: 100% 4px; pointer-events: none; }
        
        .animate-float { animation: float 3s ease-in-out infinite; }
        .animate-float-delayed { animation: float 3s ease-in-out infinite 1.5s; }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
      `}</style>
      </div>
    </div>
  );
}

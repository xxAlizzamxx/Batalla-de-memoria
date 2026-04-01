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
import { startRoundTransaction, checkRoundTimerTransaction, flipCardTransaction, useSkillTransaction, unflipCardsTransaction, resetRoomTransaction, generateBoard } from "./firestoreGameService.ts";

// Sound Utilities
const playMatchSound = () => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.5, ctx.currentTime);
  masterGain.connect(ctx.destination);
  if (ctx.state === 'suspended') ctx.resume();

  [523.25, 659.25, 1046.50].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
    g.gain.setValueAtTime(0.6, ctx.currentTime + i * 0.08);
    g.gain.setTargetAtTime(0, ctx.currentTime + i * 0.08, 0.05);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(ctx.currentTime + i * 0.08);
    osc.stop(ctx.currentTime + i * 0.08 + 0.2);
  });
};

const playMismatchSound = () => {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.4, ctx.currentTime);
  masterGain.connect(ctx.destination);
  if (ctx.state === 'suspended') ctx.resume();

  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.2);
  g.gain.setValueAtTime(0.6, ctx.currentTime);
  g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
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
      createLayer(110, "square", 0.03);
      createLayer(165, "square", 0.02);
      createLayer(220, "square", 0.01);
      break;
    case "cyberpunk":
      createLayer(40, "sawtooth", 0.08);
      createLayer(60, "sawtooth", 0.04, "bandpass");
      createLayer(120, "sawtooth", 0.02, "highpass");
      break;
    case "deepsea":
      createLayer(50, "sine", 0.12);
      createLayer(35, "sine", 0.15); // Deep resonance
      createLayer(200, "sine", 0.03, "lowpass");
      break;
    case "inferno":
      createLayer(54, "sawtooth", 0.06);
      createLayer(55, "square", 0.04); 
      createLayer(108, "sawtooth", 0.02);
      break;
    case "matrix":
      createLayer(150, "square", 0.04);
      createLayer(300, "square", 0.02, "bandpass");
      createLayer(440, "sine", 0.01);
      break;
    default: // Cosmos
      createLayer(55, "sine", 0.1, "lowpass");
      createLayer(82.41, "sine", 0.06, "lowpass"); // E1
      createLayer(110, "sine", 0.04, "lowpass"); // A1
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
           if (Math.random() > 0.8) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "square";
              const notes = [220, 261.63, 329.63, 392, 440]; // Am chord
              osc.frequency.setValueAtTime(notes[Math.floor(Math.random()*notes.length)], nextTick);
              g.gain.setValueAtTime(0.015, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.4);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.4);
           }
        } else if (skin === "cyberpunk") {
           if (Math.random() > 0.92) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              const filter = audioCtx.createBiquadFilter();
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(50 + Math.random() * 10, nextTick);
              filter.type = "lowpass";
              filter.frequency.setValueAtTime(200, nextTick);
              filter.Q.setValueAtTime(10, nextTick);
              g.gain.setValueAtTime(0.04, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 1.2);
              osc.connect(filter).connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 1.2);
           }
        } else if (skin === "deepsea") {
           if (Math.random() > 0.96) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(100 + Math.random() * 50, nextTick);
              osc.frequency.exponentialRampToValueAtTime(800, nextTick + 0.1);
              g.gain.setValueAtTime(0.01, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.2);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.2);
           }
        } else if (skin === "inferno") {
           if (Math.random() > 0.85) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "sawtooth";
              osc.frequency.setValueAtTime(40 + Math.random() * 5, nextTick);
              g.gain.setValueAtTime(0.02, nextTick);
              g.gain.linearRampToValueAtTime(0.03, nextTick + 0.4);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.6);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.6);
           }
        } else if (skin === "matrix") {
           if (Math.random() > 0.88) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "square";
              osc.frequency.setValueAtTime(1000 + Math.random() * 2000, nextTick);
              g.gain.setValueAtTime(0.008, nextTick);
              g.gain.exponentialRampToValueAtTime(0.001, nextTick + 0.05);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 0.05);
           }
        } else {
           if (Math.random() > 0.98) {
              const osc = audioCtx.createOscillator();
              const g = audioCtx.createGain();
              osc.type = "sine";
              osc.frequency.setValueAtTime(110 + Math.random() * 220, nextTick);
              g.gain.setValueAtTime(0.02, nextTick);
              g.gain.linearRampToValueAtTime(0, nextTick + 6);
              osc.connect(g).connect(masterGain);
              osc.start(nextTick); osc.stop(nextTick + 6);
           }
        }
        nextTick += 0.2;
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
  const [roomId, setRoomId] = useState<string>(() => {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    return params.get("room")?.toUpperCase() || "";
  });
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
  const [comboAnim, setComboAnim] = useState<number | null>(null);

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
          setComboAnim(ev.combo);
          setTimeout(() => setComboAnim(null), 1500);
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
    const startObj: any = { mode: selectedMode, totalRounds: selectedMode === "CLASH" ? 2 : 3 };
    
    if (selectedMode === "TEAMS" || selectedMode === "CLASH") {
      const pIds = Object.keys(gameState?.players || {}).sort(() => Math.random() - 0.5);
      const half = Math.ceil(pIds.length / 2);
      const team1Ids = pIds.slice(0, half);
      const team2Ids = pIds.slice(half);
      
      startObj.teams = {
        "TEAM_1": { 
          id: "TEAM_1", 
          name: "Equipo Rojo", 
          playerIds: team1Ids, 
          score: 0, 
          totalScore: 0, 
          board: generateBoard(1, gameState?.theme || "default"), 
          currentTurn: team1Ids[0] 
        },
        "TEAM_2": { 
          id: "TEAM_2", 
          name: "Equipo Azul", 
          playerIds: team2Ids, 
          score: 0, 
          totalScore: 0, 
          board: generateBoard(1, gameState?.theme || "default"), 
          currentTurn: team2Ids[0] 
        }
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
      
      {/* Header Container Centrado */}
      <div className="w-full max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between glass-card bg-white/5 px-6 py-4 border border-white/10 rounded-2xl shadow-xl backdrop-blur-md mb-8 relative z-20">
        
        {/* Align Left: Titulo */}
        <div className="flex items-center gap-3 w-full md:w-auto mb-4 md:mb-0 justify-center md:justify-start">
           <div className="p-2 bg-purple-500 rounded-lg"><Brain className="w-6 h-6" /></div>
           <h1 className="text-xl md:text-2xl font-serif font-bold tracking-tight">Memory Battle</h1>
        </div>
        
        {/* Align Right: Botones y Sala */}
        <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 flex-1">
           <div className="flex items-center gap-2 border-r border-white/10 pr-3">
              <span className="text-[10px] font-bold uppercase text-white/40">Sala</span>
              <span className="text-sm font-black text-purple-400 tracking-widest">{roomId}</span>
           </div>
           
           <div className="flex items-center gap-2 border-r border-white/10 pr-3">
              <span className="text-[10px] font-bold uppercase text-white/40">Ronda</span>
              <span className="text-sm font-black text-pink-400">{gameState?.currentRound || 1} <span className="text-[10px] text-white/30">/ {gameState?.totalRounds || 3}</span></span>
           </div>
           
           <button 
             onClick={() => {
                const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
                navigator.clipboard.writeText(link);
                setShowCopied(true);
                setTimeout(() => setShowCopied(false), 2000);
             }}
             className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-600/20 to-pink-600/20 hover:from-purple-600/40 hover:to-pink-600/40 rounded-lg transition-all border border-purple-500/20 hover:border-purple-500/50 group"
           >
              {showCopied ? (
                 <span className="text-[10px] font-bold uppercase text-green-400 flex items-center gap-1">¡Copiado!</span>
              ) : (
                 <>
                    <UserPlus className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold uppercase text-purple-300">Invitar a Amigos</span>
                 </>
              )}
           </button>

           <div className="flex items-center gap-2 border-l border-white/10 pl-3">
              <button onClick={() => resetRoomTransaction(roomId)} title="Reiniciar Sala" className="glass-card bg-white/5 p-2 hover:bg-white/10 rounded-lg transition-colors border border-white/10">
                 <RefreshCw className="w-4 h-4 text-white/60" />
              </button>
              <button onClick={() => setChatOpen(!chatOpen)} title="Chat" className="glass-card bg-white/5 p-2 hover:bg-white/10 rounded-lg transition-colors border border-white/10">
                 <Share2 className="w-4 h-4 text-white/60" />
              </button>
           </div>
        </div>
      </div>

      <div className="w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-8 justify-center">
        {/* Sidebar */}
        <div className="w-full lg:w-80 shrink-0 space-y-6">
           
           {/* Perfiles de Jugador en Juego */}
           {gameState?.status === "PLAYING" && (
             <div className="flex flex-col gap-4">
               {currentMode === "CLASH" && gameState.teams ? (
                 <div className="grid grid-cols-2 gap-3 glass-card p-4">
                    {(Object.values(gameState.teams) as Team[]).map(tm => {
                       const isBlue = tm.name.toLowerCase().includes("azul");
                       const isMyTeam = tm.playerIds.includes(myId || "");
                       const teamPlayers = tm.playerIds.map(id => gameState.players[id]).filter(Boolean);
                       return (
                          <div key={tm.id} className={cn("flex flex-col gap-2 rounded-xl border p-2", isBlue ? "border-blue-500/20 bg-blue-500/5" : "border-pink-500/20 bg-pink-500/5", isMyTeam && "ring-2 ring-white/20")}>
                             <div className={cn("text-[8px] font-black uppercase text-center mb-1", isBlue ? "text-blue-400" : "text-pink-400")}>
                                {tm.name} {isMyTeam && "★"}
                             </div>
                             <div className="space-y-1">
                                {teamPlayers.map(p => (
                                   <div key={p.id} className="flex items-center gap-1.5 p-1 bg-black/20 rounded-md">
                                      <div className="relative">
                                         <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className={cn("w-5 h-5 rounded-full border", p.id === myId ? "border-white" : "border-white/20")} />
                                         <AnimatePresence>
                                            {(p.lastReaction && String(p.lastReaction) !== "0" && (p.reactionTime || 0) > Date.now() - 3000) && (
                                               <motion.div initial={{ scale: 0, y: 0 }} animate={{ scale: 1.5, y: -10 }} exit={{ scale: 0 }} className="absolute -top-2 -left-1 text-[10px] z-20">
                                                  {p.lastReaction}
                                               </motion.div>
                                            )}
                                         </AnimatePresence>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                         <div className={cn("text-[7px] font-bold truncate", p.id === myId ? "text-white" : "text-white/60")}>{p.name}</div>
                                         <div className="text-[6px] font-black opacity-40">{p.score} pts</div>
                                      </div>
                                   </div>
                                ))}
                             </div>
                          </div>
                       );
                    })}
                    <div className="col-span-2 mt-2 flex justify-center gap-1">
                        {emotions.slice(0, 4).map(e => (
                           <button key={e} onClick={() => sendReaction(e)} className="text-xl p-1 hover:scale-125 transition-transform active:scale-95">{e}</button>
                        ))}
                    </div>
                 </div>
               ) : (
                 <div className="glass-card p-4 flex justify-between items-start">
                   {currentMode === "TEAMS" && myTeam ? (() => { 
                      const isBlue = myTeam.name.toLowerCase().includes("azul");
                      return (
                         <div className="flex flex-col items-center gap-2 w-[48%]">
                            <div className={cn("relative p-0.5 bg-gradient-to-b rounded-full shadow-lg", isBlue ? "from-blue-400 to-blue-600" : "from-pink-400 to-pink-600")}>
                               <div className={cn("w-12 h-12 rounded-full border-2 border-black flex items-center justify-center font-black text-xl text-white", isBlue ? "bg-blue-900" : "bg-pink-900")}>
                                  {myTeam.name[0]}
                               </div>
                               <div className={cn("absolute -bottom-2 left-1/2 -translate-x-1/2 text-[5px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white", isBlue ? "bg-blue-600" : "bg-pink-600")}>Tu Eq.</div>
                            </div>
                            <div className="text-[9px] font-black uppercase tracking-tighter w-full text-center truncate">{myTeam.name}</div>
                         </div>
                      );
                   })() : ( 
                     <div className="flex flex-col items-center gap-3 w-[48%]">
                       <div className="relative">
                         <AnimatePresence>
                            {myPlayer?.lastReaction && String(myPlayer.lastReaction) !== "0" && (myPlayer.reactionTime || 0) > Date.now() - 3000 && (
                               <motion.div initial={{ scale: 0, y: 0 }} animate={{ scale: 1.5, y: -30 }} exit={{ scale: 0, opacity: 0 }} className="absolute -top-8 left-1/2 -translate-x-1/2 text-3xl z-50">
                                  {myPlayer.lastReaction}
                               </motion.div>
                            )}
                         </AnimatePresence>
                         {(myPlayer?.shieldedUntil || 0) > Date.now() && <div className="absolute inset-0 bg-yellow-400/20 rounded-full animate-pulse border-2 border-yellow-400/50 scale-150 z-20" />}
                         <div className={cn("relative p-0.5 bg-gradient-to-b from-blue-400 to-blue-600 rounded-full shadow-[0_0_15px_rgba(59,130,246,0.3)] duration-500 z-10", (myPlayer?.frozenUntil || 0) > Date.now() ? "grayscale scale-90" : "scale-100")}>
                           <img src={myPlayer?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${myId}`} className="w-14 h-14 rounded-full border-2 border-black" />
                           <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-blue-600 text-[6px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white">Tú</div>
                         </div>
                       </div>
                       <div className="text-center w-full">
                          <div className="text-[10px] font-black text-blue-400 uppercase tracking-tighter w-full truncate">{myPlayer?.name}</div>
                          {(myPlayer?.shieldedUntil || 0) > Date.now() && <div className="text-[7px] uppercase font-bold text-yellow-500 flex items-center justify-center animate-bounce"><Shield className="w-2 h-2" /> Activo</div>}
                       </div>
                       <div className="grid grid-cols-2 gap-1 p-1 bg-white/5 rounded-xl border border-white/5 w-fit mx-auto mt-2">
                          {["😂", "😡", "😭", "🎉", "🔥", "🚀", "❤️", "👻"].map(emoji => (
                             <button key={emoji} onClick={() => sendReaction(emoji)} className="flex items-center justify-center hover:bg-white/10 rounded-md transition-transform active:scale-90 text-lg md:text-xl p-1 w-8 h-8 md:w-10 md:h-10">
                                {emoji}
                             </button>
                          ))}
                       </div>
                     </div>
                   )}

                   <div className="w-px h-full bg-white/10 min-h-[100px]" />

                   {(currentMode === "1V1" || currentMode === "TEAMS") ? (
                       currentMode === "TEAMS" ? (() => { 
                         const rivalTeam = (Object.values(gameState.teams || {}) as Team[]).find(t => t.id !== myTeam?.id);
                         if (!rivalTeam) return <div className="w-[48%]" />;
                         const isRojo = rivalTeam.name.toLowerCase().includes("rojo");
                         return (
                            <div className="flex flex-col items-center gap-2 w-[48%]">
                               <div className={cn("relative p-0.5 bg-gradient-to-b rounded-full shadow-lg", isRojo ? "from-pink-400 to-pink-600" : "from-blue-400 to-blue-600")}>
                                  <div className={cn("w-12 h-12 rounded-full border-2 border-black flex items-center justify-center font-black text-xl text-white", isRojo ? "bg-pink-900" : "bg-blue-900")}>
                                     {rivalTeam.name[0]}
                                  </div>
                                  <div className={cn("absolute -bottom-2 left-1/2 -translate-x-1/2 text-[5px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white", isRojo ? "bg-pink-600" : "bg-blue-600")}>Rival</div>
                               </div>
                               <div className="text-[9px] font-black uppercase tracking-tighter w-full text-center truncate">{rivalTeam.name}</div>
                            </div>
                         );
                       })() : (() => { 
                         const rival = playersList.find(p => p.id !== myId);
                         return (
                           <div className="flex flex-col items-center gap-3 w-[48%]">
                             <div className="relative">
                               <AnimatePresence>
                                  {rival?.lastReaction && String(rival.lastReaction) !== "0" && (rival.reactionTime || 0) > Date.now() - 3000 && (
                                     <motion.div initial={{ scale: 0, y: 0 }} animate={{ scale: 1.5, y: -30 }} exit={{ scale: 0, opacity: 0 }} className="absolute -top-8 left-1/2 -translate-x-1/2 text-3xl z-50">
                                        {rival.lastReaction}
                                     </motion.div>
                                  )}
                               </AnimatePresence>
                               <div className={cn("relative p-0.5 bg-gradient-to-b from-pink-400 to-pink-600 rounded-full shadow-[0_0_15px_rgba(236,72,153,0.3)] duration-500", (rival?.frozenUntil || 0) > Date.now() ? "grayscale scale-110" : "")}>
                                 <img src={rival?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=opp`} className="w-14 h-14 rounded-full border-2 border-black" />
                                 <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-pink-600 text-[6px] px-2 py-0.5 rounded-full font-black shadow-lg uppercase text-white">Rival</div>
                               </div>
                             </div>
                             <div className="text-center w-full">
                                <div className="text-[10px] font-black text-pink-400 uppercase tracking-tighter w-full truncate">{rival?.name || "Buscando..."}</div>
                                {(rival?.frozenUntil || 0) > Date.now() && <div className="text-[7px] uppercase font-bold text-cyan-300 flex items-center justify-center animate-pulse"><Snowflake className="w-2 h-2" /> Congelado</div>}
                             </div>
                           </div>
                         );
                       })()
                   ) : ( 
                      <div className="w-[48%] flex items-center justify-center opacity-30 text-[9px] uppercase font-black tracking-widest text-center mt-6">Contra<br/>Todos</div>
                   )}
                 </div>
               )}
             </div>
           )}

           <div className="glass-card p-6">
              <div className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-4">Jugadores</div>
              <div className="space-y-2">
                 {(playersList as Player[]).map((p: Player) => (
                    <div key={p.id} className="flex items-center gap-3 p-2 bg-white/5 rounded-lg border border-transparent hover:border-purple-500/30 transition-all">
                       <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className="w-8 h-8 rounded-full border border-purple-500/30" />
                       <span className="text-sm truncate flex-1">{p.name} {p.id === myId && "(Tú)"}</span>
                       <span className="text-xs font-bold">{p.totalScore} pts</span>
                       {gameState?.adminId === p.id && <Shield className="w-3 h-3 text-purple-400" />}
                    </div>
                 ))}
              </div>
           </div>

           {/* Personalization for ALL */}
           {gameState?.status !== "PLAYING" && (
             <div className="glass-card p-6 space-y-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-purple-400 opacity-50 mb-4">Personalización</div>
                <div className="space-y-4">
                   <div className="space-y-2">
                       <label className="text-[9px] uppercase font-bold text-white/20 block">Fichas</label>
                       <div className="grid grid-cols-2 gap-2">
                         {[
                            { id: "default", label: "Mixtos", icon: "🎲" },
                            { id: "tech", label: "Sci-Fi", icon: "🤖" },
                            { id: "animals", label: "Animal", icon: "🦁" },
                            { id: "abstract", label: "Formas", icon: "🔶" },
                            { id: "fantasy", label: "Leyendas", icon: "🐉" },
                            { id: "food", label: "Culinario", icon: "🍕" },
                            { id: "space", label: "Cosmos", icon: "🚀" }
                         ].map(theme => (
                             <button key={theme.id} onClick={() => updateDoc(doc(db, "rooms", roomId!), { [`players.${myId}.theme`]: theme.id })} className={cn("flex items-center gap-2 p-2 rounded-xl border transition-all text-xs hover:scale-105 active:scale-95", myPlayer?.theme === theme.id ? "bg-purple-500/20 border-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]" : "bg-white/5 border-white/10 opacity-50 hover:opacity-100")}>
                                <span className="text-lg leading-none">{theme.icon}</span>
                                <span className="truncate">{theme.label}</span>
                             </button>
                         ))}
                       </div>
                   </div>
                   <div className="space-y-2 pt-2 border-t border-white/5">
                       <label className="text-[9px] uppercase font-bold text-white/20 block">Interfaz</label>
                       <div className="grid grid-cols-2 gap-2">
                         {[
                            { id: "default", label: "Cosmos", icon: "🌌" },
                            { id: "retro", label: "Retro", icon: "🕹️" },
                            { id: "cyberpunk", label: "Néon", icon: "⚡" },
                            { id: "deepsea", label: "Abismo", icon: "🌊" },
                            { id: "inferno", label: "Ardiente", icon: "🔥" },
                            { id: "matrix", label: "Matrix", icon: "💻" }
                         ].map(skin => (
                             <button key={skin.id} onClick={() => updateDoc(doc(db, "rooms", roomId!), { [`players.${myId}.skin`]: skin.id })} className={cn("flex items-center gap-2 p-2 rounded-xl border transition-all text-xs hover:scale-105 active:scale-95", myPlayer?.skin === skin.id ? "bg-purple-500/20 border-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]" : "bg-white/5 border-white/10 opacity-50 hover:opacity-100")}>
                                <span className="text-lg leading-none">{skin.icon}</span>
                                <span className="truncate">{skin.label}</span>
                             </button>
                         ))}
                       </div>
                   </div>
                </div>
             </div>
           )}
                        {gameState?.status === "WAITING" && (
               <div className="space-y-4">
                  <div className="glass-card bg-white/5 p-5 space-y-6">
                      <div className="space-y-3">
                         <label className="text-[10px] uppercase font-bold text-white/30 block text-center">Modo de Juego</label>
                         
                         <div className="grid grid-cols-3 gap-2">
                           <button onClick={() => setSelectedMode("FFA")} className={cn("flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all hover:scale-105 active:scale-95 group", selectedMode === "FFA" ? "bg-purple-500/20 border-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]" : "bg-white/5 border-white/10 opacity-50 hover:opacity-100")}>
                               <Swords className="w-6 h-6 text-purple-400 group-hover:rotate-12 transition-transform" />
                               <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">Todos VS<br/>Todos</span>
                           </button>

                           <button onClick={() => Object.keys(gameState?.players || {}).length === 2 && setSelectedMode("1V1")} className={cn("flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all group", Object.keys(gameState?.players || {}).length !== 2 ? "opacity-20 cursor-not-allowed grayscale" : "hover:scale-105 active:scale-95", selectedMode === "1V1" ? "bg-pink-500/20 border-pink-500 text-white shadow-[0_0_15px_rgba(236,72,153,0.3)]" : "bg-white/5 border-white/10 opacity-50 hover:opacity-100")}>
                               <div className="flex items-center gap-1 mt-1">
                                  <UserIcon className="w-4 h-4 text-pink-400 group-hover:-translate-x-1 transition-transform" />
                                  <span className="text-[8px] font-black italic text-pink-500">VS</span>
                                  <UserIcon className="w-4 h-4 text-pink-400 group-hover:translate-x-1 transition-transform" />
                               </div>
                               <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">1 VS 1 <br/><span className="text-[6px] opacity-50">(2 Jugadores)</span></span>
                           </button>

                           <button onClick={() => Object.keys(gameState?.players || {}).length === 4 && setSelectedMode("TEAMS")} className={cn("flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all group", Object.keys(gameState?.players || {}).length !== 4 ? "opacity-20 cursor-not-allowed grayscale" : "hover:scale-105 active:scale-95", selectedMode === "TEAMS" ? "bg-blue-500/20 border-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]" : "bg-white/5 border-white/10 opacity-50 hover:opacity-100")}>
                               <div className="flex items-center justify-center gap-1 font-black text-blue-400 mt-1">
                                  <Users className="w-4 h-4 group-hover:-translate-x-1 transition-transform" /> <span className="text-[8px] italic">VS</span> <Users className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                               </div>
                               <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">Equipos <br/><span className="text-[6px] opacity-50">(4 Jugadores)</span></span>
                           </button>

                           <button onClick={() => Object.keys(gameState?.players || {}).length >= 2 && setSelectedMode("CLASH")} className={cn("col-span-3 flex flex-col items-center justify-center gap-2 p-3 rounded-xl border transition-all group", Object.keys(gameState?.players || {}).length < 2 ? "opacity-20 cursor-not-allowed grayscale" : "hover:scale-105 active:scale-95", selectedMode === "CLASH" ? "bg-orange-500/20 border-orange-500 text-white shadow-[0_0_15px_rgba(249,115,22,0.3)]" : "bg-white/5 border-white/10 opacity-50 hover:opacity-100")}>
                               <div className="flex items-center justify-center gap-2 font-black text-orange-400 mt-1">
                                  <Users className="w-4 h-4" /> <span className="text-sm italic">MEGA BATTLE</span> <Users className="w-4 h-4" />
                               </div>
                               <span className="text-[9px] font-black uppercase tracking-tighter text-center leading-tight">Clash de Equipos <br/><span className="text-[6px] opacity-50">(Simultáneo · 2 Rondas · 2-10 Jugadores)</span></span>
                           </button>
                         </div>
                         
                         {isAdmin ? (
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
                         ) : (
                           <div className="w-full bg-white/5 border border-white/10 text-white/40 font-black py-4 rounded-xl text-center text-[11px] tracking-widest uppercase mt-4 flex items-center justify-center gap-2 backdrop-blur-sm">
                             <span className="animate-pulse">Esperando al Anfitrión</span>
                             <span className="flex gap-1"><span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span><span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span><span className="w-1 h-1 bg-white/40 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span></span>
                           </div>
                         )}
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
           {/* Stats Grid - Visible before and during Play */}
           <div className="w-full max-w-5xl flex flex-wrap justify-center gap-4 mb-8">
              {[
                { label: 'Tiempo', value: `${gameState?.time || 0}s`, icon: Timer, color: 'text-purple-400' },
                { label: 'Parejas', value: myBoard && myBoard.filter ? myBoard.filter(c => c.matched).length / 2 : 0, icon: Brain, color: 'text-pink-400' },
                { label: 'Combo', value: myPlayer?.combo || 0, icon: Flame, color: 'text-orange-400' },
                { label: 'Estado', value: gameState?.status === "PLAYING" ? "En Juego" : "Sala de Espera", icon: Zap, color: 'text-green-400' }
              ].map((stat, i) => (
                <div key={i} className="flex-1 min-w-[120px] glass-card bg-white/5 p-4 flex flex-col items-center justify-center text-center group hover:bg-white/10 transition-all border-b-2 border-transparent hover:border-purple-500/50">
                   <stat.icon className={cn("w-6 h-6 mb-2 opacity-50 group-hover:opacity-100 transition-opacity", stat.color)} />
                   <div className="text-2xl font-black tracking-tighter">{stat.value}</div>
                   <div className="text-[10px] uppercase font-bold tracking-[0.2em] opacity-30 group-hover:opacity-60 transition-opacity">{stat.label}</div>
                </div>
              ))}
           </div>
 
           {/* Skills above the board */}
           {gameState?.status === "PLAYING" && (
               <div className="w-full max-w-4xl grid grid-cols-4 gap-4 mb-8 animate-in slide-in-from-top duration-500">
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
                      className="flex flex-col items-center justify-center p-4 bg-white/5 rounded-2xl border border-white/10 hover:bg-white/10 hover:scale-105 active:scale-95 disabled:opacity-20 transition-all group shadow-lg"
                    >
                      <div className="relative">
                         <skill.icon className={cn("w-8 h-8 mb-2 drop-shadow-lg", skill.color)} />
                         {myPlayer?.skills[skill.id as keyof typeof myPlayer.skills]! > 0 && (
                            <div className="absolute -top-3 -right-3 bg-green-500 text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center animate-bounce shadow-[0_0_10px_rgba(34,197,94,0.5)]">
                               {myPlayer?.skills[skill.id as keyof typeof myPlayer.skills]}
                            </div>
                         )}
                      </div>
                      <span className="text-xs font-black uppercase tracking-tighter opacity-80">{skill.label}</span>
                    </button>
                  ))}
               </div>
           )}

            <div className="relative w-full flex-1 flex flex-col items-center justify-center min-h-[50vh] mt-[-20px]">
               <AnimatePresence>
                  {comboAnim && (
                     <motion.div
                        initial={{ scale: 0.5, opacity: 0, y: 50 }}
                        animate={{ scale: 1.2, opacity: 1, y: 0 }}
                        exit={{ scale: 2, opacity: 0, y: -50 }}
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-50 font-black italic text-6xl md:text-8xl text-orange-400 drop-shadow-[0_0_30px_rgba(251,146,60,1)] uppercase whitespace-nowrap"
                     >
                        COMBO x{comboAnim}
                     </motion.div>
                  )}
               </AnimatePresence>

               {gameState?.status === "PLAYING" && currentMode === "1V1" && (() => {
                  const rival = playersList.find(p => p.id !== myId);
                  if (!rival || !rival.board) return null;
                  const rBoard = rival.board;
                  const rCols = Math.ceil(Math.sqrt(rBoard.length || 16));
                  return (
                     <div className="absolute top-0 right-0 md:top-4 md:right-4 w-20 md:w-28 bg-black/40 p-2 rounded-2xl border border-white/10 backdrop-blur-md shadow-2xl z-40 hidden md:flex flex-col">
                        <div className="text-[8px] uppercase font-black tracking-widest text-pink-400 mb-2 truncate text-center flex items-center justify-center gap-1">
                           <img src={rival.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${rival.id}`} className="w-3 h-3 rounded-full border border-pink-500" />
                           {rival.name}
                        </div>
                        <div 
                           className="grid gap-[2px] w-full aspect-square"
                           style={{ gridTemplateColumns: `repeat(${rCols}, minmax(0, 1fr))` }}
                        >
                           {rBoard.map(c => {
                               const reveal = c.flipped || c.matched;
                               return (
                                  <div key={c.id} className={cn("w-full h-full aspect-square rounded-[2px] border", reveal ? (c.matched ? "bg-green-500 border-green-400" : "bg-pink-600 border-pink-400") : "bg-white/10 border-white/5")} />
                               );
                           })}
                        </div>
                     </div>
                  );
               })()}

                  {gameState?.status === "WAITING" && (
                    <div className="text-center py-32 bg-white/2 rounded-[50px] border border-dashed border-white/10 w-full max-w-4xl shadow-2xl">
                       <motion.div 
                         className="relative inline-block mb-10"
                         animate={{ opacity: [0.3, 1, 0.3], scale: [0.95, 1.1, 0.95] }}
                         transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                       >
                          <div className="absolute inset-0 bg-purple-500/30 blur-[40px] rounded-full" />
                          <Brain className="w-32 h-32 text-purple-400 mx-auto relative z-10" />
                       </motion.div>
                       <div className="font-serif italic text-white/40 text-3xl md:text-4xl mb-4">Preparando la arena mental...</div>
                       <div className="text-xs md:text-sm uppercase tracking-[0.4em] font-black text-white/20">Esperando el inicio de la batalla de memoria</div>
                    </div>
                  )}
 
                  {gameState?.status === "PLAYING" && (() => {
                      const len = boardToDisplay.length || 16;
                      const cols = Math.ceil(Math.sqrt(len));
                      const rows = Math.ceil(len / cols);
                      
                      return (
                         <div 
                             className={cn(
                                "grid gap-1.5 md:gap-2 mx-auto w-full max-w-5xl",
                                activeSkillAnim === "SHUFFLE" && "animate-bounce"
                             )}
                             style={{ 
                                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                                maxWidth: `min(100%, calc(55vh * ${cols} / ${rows}))`
                             }}
                          >
                            {boardToDisplay.map(c => {
                               const reveal = c.flipped || c.matched || (peekActive && boardToDisplay === myBoard);
                               const isSpectatingTheirBoard = spectatedPlayer && boardToDisplay === spectatedPlayer.board;
                               const targetPlayer = spectatedPlayer || myPlayer;
                               const isFrozen = (targetPlayer?.frozenUntil || 0) > Date.now();
                               
                               return (
                                 <div key={c.id} onClick={() => !c.isStatic && flipCard(c.id)} className={cn(
                                    "aspect-square w-full rounded-xl transition-all duration-500 relative group preserve-3d shadow-xl will-change-transform", 
                                    reveal ? "rotate-y-180" : "bg-white/5 hover:bg-white/10 hover:scale-[1.03] active:scale-95",
                                    !c.isStatic && "cursor-pointer",
                                    c.isStatic && "bg-gradient-to-tr from-purple-900/40 to-pink-900/40 border-2 border-purple-500/30",
                                    isFrozen && "opacity-50 grayscale pointer-events-none"
                                 )}>
                                    <div className={cn(
                                       "absolute inset-0 flex items-center justify-center text-3xl sm:text-4xl lg:text-5xl backface-hidden rounded-xl border border-white/10 overflow-hidden will-change-transform", 
                                       c.matched ? "bg-green-500 shadow-[0_0_20px_#22c55e] border-green-300" :
                                       reveal ? "bg-purple-600 shadow-[0_0_15px_rgba(147,51,234,0.4)] border-purple-400" : "bg-white/5",
                                       myPlayer?.skin === "retro" && "border-4 border-black border-double text-black",
                                       myPlayer?.skin === "cyberpunk" && reveal && "bg-cyan-500/80 shadow-[0_0_25px_cyan] border-cyan-300",
                                       myPlayer?.skin === "inferno" && !reveal && "bg-orange-950/40"
                                    )}>
                                       <div className={cn(
                                           reveal ? "scale-100 opacity-100" : "scale-0 opacity-0",
                                           "transition-all duration-500 ease-in-out transform font-serif font-black will-change-transform"
                                       )}>
                                          {c.value}
                                       </div>
                                       {!reveal && (
                                          <div className="absolute inset-0 flex items-center justify-center opacity-30 group-hover:opacity-60 transition-opacity">
                                             {myPlayer?.skin === "retro" ? <div className="text-[10px] font-black line-through">PIXEL</div> : <Brain className="w-1/2 h-1/2" />}
                                          </div>
                                       )}
                                       {(!reveal && isFrozen) ? <div className="absolute inset-0 bg-cyan-400/30 flex items-center justify-center backdrop-blur-sm"><Snowflake className="w-1/2 h-1/2 text-cyan-200 animate-pulse" /></div> : null}
                                    </div>
                                    {!reveal && <div className="absolute inset-0 bg-gradient-to-tr from-white/0 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" />}
                                 </div>
                               );
                            })}
                        </div>
                      );
                  })()}

                 {gameState?.status === "ROUND_END" && (
                    <div className="text-center py-20 p-12 glass-card border-blue-500/50 flex flex-col items-center w-full max-w-2xl">
                       <Timer className="w-16 h-16 text-blue-400 mx-auto mb-6 opacity-30" />
                       <h2 className="text-4xl font-serif font-black mb-2 uppercase tracking-tight text-glow">Fin de la Ronda {gameState.currentRound}</h2>
                       <p className="text-white/40 mb-8 font-mono">Calculando resultados de la ronda y sumando puntos...</p>
                       
                       <div className="flex items-end justify-center gap-2 md:gap-4 mb-4 mt-8 h-64 w-full">
                           {gameState?.mode === "CLASH" && gameState.teams ? (() => {
                              const teams = Object.values(gameState.teams) as Team[];
                              const t1 = teams[0];
                              const t2 = teams[1];
                              const t1Wins = t1.score >= t2.score;
                              
                              return (
                                 <div className="w-full flex items-center justify-between gap-4 px-4 h-full">
                                    {/* Team 1 Score Summary */}
                                    <div className="flex-1 flex flex-col items-center">
                                       <motion.div 
                                          initial={{ x: -100, opacity: 0 }} 
                                          animate={{ x: 0, opacity: 1 }} 
                                          className={cn("p-6 rounded-3xl border-2 flex flex-col items-center gap-4 transition-all w-full", t1Wins ? "bg-pink-500/20 border-pink-500 shadow-[0_0_40px_rgba(236,72,153,0.3)]" : "bg-white/5 border-white/10 opacity-40")}
                                       >
                                          {t1Wins && <div className="bg-pink-500 text-[10px] font-black px-4 py-1 rounded-full animate-bounce">GANANDO</div>}
                                          <div className={cn("text-6xl font-black italic", t1Wins ? "text-white" : "text-white/40")}>{t1.score}</div>
                                          <div className="text-[10px] font-black uppercase tracking-widest opacity-60">EQUIPO ROJO</div>
                                       </motion.div>
                                    </div>

                                    {/* VS Icon Middle */}
                                    <div className="shrink-0 flex items-center justify-center">
                                       <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center border border-white/20">
                                          <Swords className="w-6 h-6 text-white/40" />
                                       </div>
                                    </div>

                                    {/* Team 2 Score Summary */}
                                    <div className="flex-1 flex flex-col items-center">
                                       <motion.div 
                                          initial={{ x: 100, opacity: 0 }} 
                                          animate={{ x: 0, opacity: 1 }} 
                                          className={cn("p-6 rounded-3xl border-2 flex flex-col items-center gap-4 transition-all w-full", !t1Wins ? "bg-blue-500/20 border-blue-500 shadow-[0_0_40px_rgba(59,130,246,0.3)]" : "bg-white/5 border-white/10 opacity-40")}
                                       >
                                          {!t1Wins && <div className="bg-blue-500 text-[10px] font-black px-4 py-1 rounded-full animate-bounce">GANANDO</div>}
                                          <div className={cn("text-6xl font-black italic", !t1Wins ? "text-white" : "text-white/40")}>{t2.score}</div>
                                          <div className="text-[10px] font-black uppercase tracking-widest opacity-60">EQUIPO AZUL</div>
                                       </motion.div>
                                    </div>
                                 </div>
                              );
                           })() : (() => {
                              const topPlayers = [...playersList].sort((a,b) => b.totalScore - a.totalScore).slice(0, 3);
                              const podiumOrdered = [topPlayers[1], topPlayers[0], topPlayers[2]];
                              
                              return podiumOrdered.map((p, idx) => {
                                 if (!p) return <div key={`empty-${idx}`} className="w-24 md:w-32" />;
                                 const isFirst = idx === 1;
                                 const isSecond = idx === 0;
                                 const isThird = idx === 2;
                                 const position = isFirst ? 1 : isSecond ? 2 : 3;
                                 
                                 return (
                                    <div key={p.id} className="flex flex-col items-center justify-end h-full">
                                       <motion.div 
                                          initial={{ y: 50, opacity: 0 }}
                                          animate={{ y: 0, opacity: 1 }}
                                          transition={{ delay: isFirst ? 0.4 : isSecond ? 0.2 : 0 }}
                                          className="flex flex-col items-center mb-2 z-10"
                                       >
                                          <div className={cn("relative p-1 rounded-full bg-gradient-to-b shadow-xl", isFirst?"from-yellow-400 to-yellow-600":isSecond?"from-slate-300 to-slate-500":"from-amber-600 to-amber-800")}>
                                             <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className="w-12 h-12 md:w-16 md:h-16 rounded-full border-2 border-black" />
                                             <div className={cn("absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center font-black text-xs md:text-sm text-black shadow-lg", isFirst?"bg-yellow-400":isSecond?"bg-slate-300":"bg-amber-600")}>
                                                {position}
                                             </div>
                                          </div>
                                          <div className="text-[9px] md:text-[10px] font-black uppercase tracking-tighter w-20 md:w-28 text-center truncate mt-3">{p.name}</div>
                                       </motion.div>
                                       
                                       <motion.div 
                                          initial={{ height: 0 }}
                                          animate={{ height: isFirst ? '140px' : isSecond ? '100px' : '70px' }}
                                          className={cn("w-24 md:w-32 rounded-t-xl flex flex-col items-center justify-start pt-4 border-t-2 border-x-2 shadow-2xl relative overflow-hidden", 
                                             isFirst ? "bg-gradient-to-b from-yellow-500/30 to-yellow-900/10 border-yellow-500/50" : 
                                             isSecond ? "bg-gradient-to-b from-slate-400/30 to-slate-800/10 border-slate-400/50" : 
                                             "bg-gradient-to-b from-amber-600/30 to-amber-900/10 border-amber-600/50"
                                          )}
                                       >
                                          <div className={cn("text-lg font-black drop-shadow-md", isFirst?"text-yellow-400":isSecond?"text-slate-300":"text-amber-500")}>
                                             {p.totalScore} pts
                                          </div>
                                       </motion.div>
                                    </div>
                                 );
                              });
                           })()}
                       </div>

                       <div className="w-full max-w-4xl grid md:grid-cols-2 gap-4 mb-12 text-left">
                          {gameState?.mode === "CLASH" && gameState.teams ? (
                             (Object.values(gameState.teams) as Team[]).map(tm => {
                                const isBlue = tm.name.toLowerCase().includes("azul");
                                const teamPlayers = tm.playerIds.map(id => gameState.players[id]).filter(Boolean).sort((a,b) => b.score - a.score);
                                return (
                                   <div key={tm.id} className={cn("bg-white/5 rounded-2xl border p-4 shadow-2xl", isBlue ? "border-blue-500/30" : "border-pink-500/30")}>
                                      <div className={cn("text-xs font-black uppercase tracking-widest mb-4 flex justify-between items-center", isBlue ? "text-blue-400" : "text-pink-400")}>
                                         <span>{tm.name}</span>
                                         <span className="text-xl">{tm.totalScore} pts</span>
                                      </div>
                                      <div className="space-y-1">
                                         {teamPlayers.map((p, i) => (
                                            <div key={p.id} className="flex justify-between items-center p-2 rounded-lg bg-white/5 text-[11px]">
                                               <div className="flex items-center gap-2">
                                                  <span className="opacity-30">{i+1}</span>
                                                  <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className="w-5 h-5 rounded-full" />
                                                  <span className="font-bold">{p.name}</span>
                                               </div>
                                               <div className="font-black opacity-80">{p.score}</div>
                                            </div>
                                         ))}
                                      </div>
                                   </div>
                                );
                             })
                          ) : (
                            <div className="col-span-2 bg-white/5 rounded-2xl border border-white/10 p-4 overflow-hidden shadow-2xl">
                               <div className="text-[10px] uppercase font-black text-purple-400 opacity-80 mb-3 px-2 flex items-center gap-2"><Trophy className="w-4 h-4" /> Clasificación Global</div>
                               <div className="space-y-1">
                                  {[...playersList].sort((a,b) => b.totalScore - a.totalScore).map((p, i) => (
                                     <div key={p.id} className="flex justify-between items-center p-2 rounded-lg hover:bg-white/10 transition-colors text-xs space-x-2 border-b border-white/5 last:border-0 relative overflow-hidden group">
                                        <div className="flex items-center gap-3 relative z-10 w-full">
                                           <span className={cn("w-4 text-center font-black", i===0?"text-yellow-400":i===1?"text-slate-300":i===2?"text-amber-500":"text-white/30")}>{i+1}</span>
                                           <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className="w-6 h-6 rounded-full border border-white/10" />
                                           <span className="truncate flex-1 font-bold">{p.name}</span>
                                           <div className="text-purple-400 font-black shrink-0">{p.totalScore} pts</div>
                                        </div>
                                        {i === 0 && <div className="absolute inset-0 bg-yellow-500/5 opacity-50 group-hover:opacity-100 transition-opacity" />}
                                     </div>
                                  ))}
                               </div>
                            </div>
                          )}
                       </div>

                       {isAdmin ? (
                         <button onClick={() => roomId && startRoundTransaction(roomId, gameState.currentRound + 1)} className="group relative inline-flex items-center justify-center px-12 py-5 font-black text-white bg-gradient-to-r from-blue-600 to-purple-600 rounded-full overflow-hidden shadow-[0_0_40px_rgba(37,99,235,0.5)] hover:scale-[1.02] hover:shadow-[0_0_60px_rgba(37,99,235,0.7)] active:scale-95 transition-all uppercase tracking-widest text-sm">
                            <span className="relative z-10 flex items-center gap-2">Siguiente Ronda <ArrowRight className="w-5 h-5 group-hover:translate-x-2 transition-transform" /></span>
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                         </button>
                       ) : (
                         <div className="text-[11px] font-black tracking-widest uppercase text-white/50 animate-pulse bg-white/5 px-8 py-4 rounded-xl">
                            Esperando que el anfitrión inicie la siguiente ronda...
                         </div>
                       )}
                    </div>
                 )}

                 {gameState?.status === "TOURNAMENT_END" && (
                      <div className="text-center py-20 glass-card bg-white/5 p-12 border-purple-500/50 scale-in flex flex-col items-center">
                         {gameState.mode === "CLASH" && gameState.teams ? (() => {
                             const sortedTeams = (Object.values(gameState.teams) as Team[]).sort((a,b) => b.totalScore - a.totalScore);
                             const winner = sortedTeams[0];
                             const isBlue = winner.name.toLowerCase().includes("azul");
                             return (
                                <>
                                   <div className={cn("inline-flex items-center justify-center p-6 rounded-full mb-6 relative", isBlue ? "bg-blue-500/20 shadow-[0_0_50px_rgba(59,130,246,0.6)]" : "bg-pink-500/20 shadow-[0_0_50px_rgba(236,72,153,0.6)]")}>
                                      <Trophy className={cn("w-20 h-20", isBlue ? "text-blue-400" : "text-pink-400")} />
                                      <div className="absolute inset-0 animate-ping rounded-full border-4 border-white/20" />
                                   </div>
                                   <motion.h2 initial={{ scale: 0.5 }} animate={{ scale: 1 }} className="text-6xl font-serif font-black mb-2 uppercase tracking-tight text-white drop-shadow-lg">¡VICTORIA!</motion.h2>
                                   <div className={cn("text-2xl font-black uppercase tracking-widest mb-8", isBlue ? "text-blue-400" : "text-pink-400")}>{winner.name}</div>
                                   <div className="flex gap-4 mb-8">
                                      {sortedTeams.map(t => (
                                         <div key={t.id} className="glass-card p-4 border-white/10 bg-white/5">
                                            <div className="text-[10px] font-black opacity-40 uppercase mb-1">{t.name}</div>
                                            <div className="text-2xl font-black">{t.totalScore} <span className="text-xs opacity-40">PTS</span></div>
                                         </div>
                                      ))}
                                   </div>
                                </>
                             );
                         })() : (
                            <>
                               <Trophy className="w-20 h-20 text-yellow-500 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(234,179,8,0.5)]" />
                               <h2 className="text-4xl font-serif font-black mb-2 uppercase tracking-tight text-glow">Partida Finalizada</h2>
                               <p className="text-white/40 mb-8 font-mono">El ganador ha sido coronado en el salón de la fama.</p>
                               <div className="flex flex-col gap-3 max-w-xs mx-auto w-full">
                                  {playersList.slice(0, 3).map((p, i) => (
                                     <div key={p.id} className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/5">
                                        <span className="text-2xl font-black text-white/20">{i+1}</span>
                                        <img src={p.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.id}`} className="w-10 h-10 rounded-full" />
                                        <div className="flex-1 text-left font-bold truncate">{p.name}</div>
                                        <div className="font-black text-purple-400">{p.totalScore}</div>
                                     </div>
                                  ))}
                               </div>
                            </>
                         )}
                         <button onClick={() => roomId && resetRoomTransaction(roomId)} className="mt-8 bg-white text-black font-black px-8 py-3 rounded-full hover:bg-purple-500 hover:text-white transition-all uppercase tracking-widest text-xs">Volver al Lobby</button>
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
        .rotate-y-180 { transform: rotateY(180deg); transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
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

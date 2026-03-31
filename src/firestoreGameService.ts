import { doc, runTransaction, updateDoc } from "firebase/firestore";
import { db } from "./firebase.ts";
import { GameState, Player, Card, Team } from "./types.ts"; // We will put types here

export const resetRoomTransaction = async (roomId: string) => {
  const roomRef = doc(db, "rooms", roomId);
  await runTransaction(db, async (t) => {
    const docSnap = await t.get(roomRef);
    if (!docSnap.exists()) return;
    const g = docSnap.data() as GameState;

    g.status = "WAITING";
    g.skin = "default";
    g.theme = "default";
    g.started = false;
    g.winner = null;
    g.currentRound = 1;
    g.time = 50;
    
    Object.values(g.players).forEach(p => {
      p.score = 0;
      p.totalScore = 0;
      p.timeSpent = 0;
      p.eliminated = false;
      p.board = [];
      p.combo = 0;
      p.skills = { peek: 1, freeze: 0, shield: 0, shuffle: 0 };
    });

    if (g.teams) {
       delete g.teams;
    }

    g.lastEvent = null;
    t.update(roomRef, g as any);
  });
};

export const generateBoard = (round: number, theme: string = "default"): Card[] => {
  const cardCounts = [16, 36, 64];
  const count = cardCounts[round - 1] || 16;
  const pairCount = count / 2;

  let allValues = [
    "🟥", "🟡", "🔺", "🔷", "⭐", "🌙", "🌀", "💠",
    "🍀", "💎", "🍎", "🍕", "🚀", "🛸", "👾", "👻",
    "🎃", "⚡", "🌈", "🔥", "❄️", "🌋", "🪐", "🦄",
    "🐉", "🦁", "🦊", "🐼", "🐨", "🐯", "🐸", "🐙"
  ];

  if (theme === "tech") {
    allValues = ["💻", "📱", "⌚", "🕹️", "⌨️", "🖱️", "🎮", "🔋", "🔌", "💾", "💿", "💡", "📡", "🔭", "🔬", "🚀", "🛸", "🛰️", "🤖", "⚙️", "🔧", "🧲", "🧬", "🧪", "🧫", "📺", "📻", "📷", "🎥", "🔭", "📡", "🛰️"];
  } else if (theme === "animals") {
    allValues = ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜"];
  } else if (theme === "abstract") {
    allValues = ["🔺", "🔴", "🟦", "🟡", "🟩", "♦️", "🔷", "🔶", "🛑", "💠", "🔘", "🔳", "🔲", "〰️", "➰", "➖", "➕", "✖️", "➗", "🎵", "🎶", "♠️", "♣️", "♥️", "♦️", "⚪", "⚫", "🟤", "🟣", "🟠", "🌀", "💠"];
  } else if (theme === "fantasy") {
    allValues = ["🧙‍♂️", "🧚‍♀️", "🐉", "🧛‍♂️", "🧟‍♂️", "🧜‍♂️", "🦄", "🏰", "⚔️", "🛡️", "🏹", "🔮", "🧪", "📜", "🪙", "🔱", "🧿", "🕯️", "👹", "👺", "🏺", "🏔️", "🌑", "🍄", "🌳", "🪵", "⛰️", "🛶", "⛺", "🛖", "🎭", "🗡️"];
  } else if (theme === "food") {
    allValues = ["🍕", "🍔", "🍟", "🌭", "🍖", "🥨", "🍳", "🧇", "🥓", "🍩", "🍪", "🎂", "🍰", "🧁", "🍦", "🍫", "🍬", "🍭", "🍇", "🍓", "🍒", "🥦", "🍣", "🌮", "🌯", "🍲", "🥡", "🍜", "🍞", "🧀", "🍳", "🥨"];
  } else if (theme === "space") {
    allValues = ["🪐", "🌍", "🌕", "☀️", "☄️", "🌌", "🚀", "🛰️", "🛸", "👾", "👽", "👨‍🚀", "👩‍🚀", "🔭", "🌑", "🌓", "🌔", "🌠", "🛰️", "💥", "🟤", "⚪", "⚫", "🔵", "🌌", "☄️", "🌠", "🌀", "⭐", "🔭", "🌍", "🪐"];
  }

  const values = allValues.slice(0, pairCount);
  const pairs = [...values, ...values];
  const shuffled = pairs.sort(() => Math.random() - 0.5);
  return shuffled.map((value, index) => ({
    id: index,
    value,
    flipped: false,
    matched: false,
  }));
};

export const startRoundTransaction = async (roomId: string, round: number) => {
  const roomRef = doc(db, "rooms", roomId);
  
  await runTransaction(db, async (t) => {
    const docSnap = await t.get(roomRef);
    if (!docSnap.exists()) return;
    const g = docSnap.data() as GameState;

    g.currentRound = round;
    g.started = true;
    g.status = "PLAYING";
    g.winner = null;
    g.time = round === 1 ? 50 : round === 2 ? 90 : 120;
    
    if (g.mode === "TEAMS" && g.teams) {
      Object.keys(g.teams).forEach(tId => {
        g.teams![tId].score = 0;
        g.teams![tId].board = generateBoard(round, g.theme);
        g.teams![tId].currentTurn = g.teams![tId].playerIds[0];
      });
    }

    Object.keys(g.players).forEach(id => {
      const gsp = g.players[id];
      gsp.timeSpent = 0;
      gsp.combo = 0;
      gsp.score = 0;

      if (gsp.eliminated) {
        gsp.board = [];
      } else {
        gsp.board = generateBoard(round, gsp.theme || g.theme || "default");
        // Only grant peek on Round 1 if it's 0, or handle properly
        if (round > 1) {
          gsp.skills.peek = (gsp.skills.peek || 0) + 1;
        }
      }
    });

    // Clear any previous events
    g.lastEvent = null;

    t.update(roomRef, g as any);
  });
};

export const checkRoundTimerTransaction = async (roomId: string) => {
  const roomRef = doc(db, "rooms", roomId);
  await runTransaction(db, async (t) => {
    const docSnap = await t.get(roomRef);
    if (!docSnap.exists()) return;
    const g = docSnap.data() as GameState;
    if (g.status !== "PLAYING") return;
    
    g.time -= 1;
    
    // Check if round should end
    let allFinished = false;
    
    if (g.mode === "TEAMS" && g.teams) {
      Object.keys(g.players).forEach(id => {
        const team = (Object.values(g.teams!) as Team[]).find(t => t.playerIds.includes(id));
        if (team && !team.board.every(c => c.matched)) {
          g.players[id].timeSpent += 1;
        }
      });
      const activeTeams = Object.values(g.teams);
      if (activeTeams.length > 0 && activeTeams.every(tm => tm.board.every(c => c.matched))) {
        allFinished = true;
      }
    } else {
      Object.keys(g.players).forEach(id => {
        if (!g.players[id].eliminated && !g.players[id].board.every(c => c.matched)) {
           g.players[id].timeSpent += 1;
        }
      });
      const activePlayers = Object.values(g.players).filter(p => !p.eliminated);
      if (activePlayers.length > 0 && activePlayers.every(p => p.board.every(c => c.matched))) {
        allFinished = true;
      }
    }

    if (g.time <= 0 || allFinished) {
      g.status = "ROUND_END";
      
      if (g.mode === "TEAMS" && g.teams) {
        Object.values(g.teams).forEach(tm => { tm.totalScore += tm.score; });
        if (g.currentRound >= g.totalRounds) {
          g.status = "TOURNAMENT_END";
          g.started = false;
          const sorted = Object.values(g.teams).sort((a, b) => b.totalScore - a.totalScore);
          g.winner = sorted[0] ? sorted[0].name : "Nadie";
          g.lastEvent = { type: "GAME_OVER", winner: g.winner };
        }
      } else {
        Object.values(g.players).forEach(p => { p.totalScore += p.score; });
        const activePlayers = Object.values(g.players)
          .filter(p => !p.eliminated)
          .sort((a, b) => b.score - a.score || a.timeSpent - b.timeSpent);
        
        if (activePlayers.length > 2 && g.currentRound < g.totalRounds) {
          const toEl = activePlayers.slice(-2);
          toEl.forEach(p => p.eliminated = true);
        }

        if (g.currentRound >= g.totalRounds) {
          g.status = "TOURNAMENT_END";
          g.started = false;
          const sortedTotal = Object.values(g.players).sort((a, b) => b.totalScore - a.totalScore);
          g.winner = sortedTotal[0] ? sortedTotal[0].name : "Nadie";
          g.lastEvent = { type: "GAME_OVER", winner: g.winner };
        }
      }
    }
    
    t.update(roomRef, g as any);
  });
};

export const flipCardTransaction = async (roomId: string, playerId: string, cardId: number) => {
  const roomRef = doc(db, "rooms", roomId);
  await runTransaction(db, async (t) => {
    const docSnap = await t.get(roomRef);
    if (!docSnap.exists()) return;
    const g = docSnap.data() as GameState;
    if (g.status !== "PLAYING" || !g.started) return;
    
    const gsp = g.players[playerId];
    if (!gsp || gsp.eliminated || gsp.frozenUntil > Date.now()) return;

    let activeBoard: Card[] = [];
    let currentTeam: Team | undefined;

    if (g.mode === "TEAMS" && g.teams) {
      currentTeam = (Object.values(g.teams) as Team[]).find(tm => tm.playerIds.includes(playerId));
      if (!currentTeam || currentTeam.currentTurn !== playerId) return;
      activeBoard = currentTeam.board;
    } else {
      activeBoard = gsp.board;
    }

    const currentlyFlipped = activeBoard.filter(c => c.flipped && !c.matched);
    if (currentlyFlipped.length >= 2) return;

    const card = activeBoard[cardId];
    if (!card || card.flipped || card.matched) return;

    card.flipped = true;
    const flippedCards = activeBoard.filter(c => c.flipped && !c.matched);

    if (flippedCards.length === 2) {
      if (flippedCards[0].value === flippedCards[1].value) {
        flippedCards[0].matched = true;
        flippedCards[1].matched = true;
        gsp.combo += 1;
        gsp.score += (10 + gsp.combo * 5);

        let grantedSkill = null;
        if (Math.random() < 0.3 || gsp.combo >= 3) {
          const abilities = ["peek", "freeze", "shield", "shuffle"];
          grantedSkill = abilities[Math.floor(Math.random() * abilities.length)];
          gsp.skills[grantedSkill] = (gsp.skills[grantedSkill] || 0) + 1;
        }

        g.lastEvent = { id: (Date.now() + Math.random()).toString(), type: "MATCH_FOUND", playerId: playerId, combo: gsp.combo, skill: grantedSkill || "" };
      } else {
        // Do NOT flip back to false here. Allow the client to see them for ~1s
        // then call unflipCardsTransaction.
        gsp.combo = 0;

        if (g.mode === "TEAMS" && currentTeam) {
            currentTeam.currentTurn = currentTeam.playerIds.find(p => p !== playerId) || playerId;
        }
        g.lastEvent = { id: (Date.now() + Math.random()).toString(), type: "MISMATCH", playerId: playerId, target: (g.mode === "TEAMS" && currentTeam) ? currentTeam.id : "" };
      }
    }

    t.update(roomRef, g as any);
  });
};

export const unflipCardsTransaction = async (roomId: string, playerId: string) => {
  const roomRef = doc(db, "rooms", roomId);
  await runTransaction(db, async (t) => {
    const docSnap = await t.get(roomRef);
    if (!docSnap.exists()) return;
    const g = docSnap.data() as GameState;
    if (g.status !== "PLAYING") return;
    
    let activeBoard: Card[] = [];
    if (g.mode === "TEAMS" && g.teams) {
      const team = (Object.values(g.teams) as Team[]).find(tm => tm.playerIds.includes(playerId));
      if (!team) return;
      activeBoard = team.board;
    } else {
      const gsp = g.players[playerId];
      if (!gsp) return;
      activeBoard = gsp.board;
    }

    const flippedCards = activeBoard.filter(c => c.flipped && !c.matched);
    if (flippedCards.length === 2) {
      // Unflip them
      flippedCards[0].flipped = false;
      flippedCards[1].flipped = false;
      t.update(roomRef, g as any);
    }
  });
};

export const useSkillTransaction = async (roomId: string, playerId: string, skill: string) => {
  const roomRef = doc(db, "rooms", roomId);
  const now = Date.now();
  await runTransaction(db, async (t) => {
    const docSnap = await t.get(roomRef);
    if (!docSnap.exists()) return;
    const g = docSnap.data() as GameState;
    if (g.status !== "PLAYING" || !g.started) return;

    const skillPlayer = g.players[playerId];
    if (!skillPlayer || skillPlayer.eliminated || !skillPlayer.skills[skill] || skillPlayer.skills[skill] <= 0) return;

    skillPlayer.skills[skill] -= 1;

    if (skill === "peek") {
      g.lastEvent = { id: Date.now(), type: "SKILL_ACTIVATED", playerId: playerId, skill: "peek" };
    } else if (skill === "freeze") {
      const opponents = Object.values(g.players).filter(p => !p.eliminated && p.id !== playerId);
      const vulnerable = opponents.filter(p => p.shieldedUntil < now);
      if (vulnerable.length > 0) {
        const target = vulnerable[Math.floor(Math.random() * vulnerable.length)];
        target.frozenUntil = now + 5000;
        g.lastEvent = { id: Date.now(), type: "SKILL_ACTIVATED", playerId: playerId, skill: "freeze", target: target.id, by: skillPlayer.name };
      }
    } else if (skill === "shield") {
      skillPlayer.shieldedUntil = now + 10000;
      g.lastEvent = { id: Date.now(), type: "SKILL_ACTIVATED", playerId: playerId, skill: "shield" };
    } else if (skill === "shuffle") {
      const opponents = Object.values(g.players).filter(p => !p.eliminated && p.id !== playerId);
      const vulnerable = opponents.filter(p => p.shieldedUntil < now);
      if (vulnerable.length > 0) {
        const target = vulnerable[Math.floor(Math.random() * vulnerable.length)];
        const targetBoard = target.board;
        const unmatched = targetBoard.filter(c => !c.matched);
        const values = unmatched.map(c => c.value);
        values.sort(() => Math.random() - 0.5);
        let vIdx = 0;
        targetBoard.forEach(c => {
          if (!c.matched) {
            c.value = values[vIdx++];
            c.flipped = false;
          }
        });
        g.lastEvent = { id: Date.now(), type: "SKILL_ACTIVATED", playerId: playerId, skill: "shuffle", target: target.id, by: skillPlayer.name };
      }
    }

    t.update(roomRef, g as any);
  });
};

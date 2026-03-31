import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Player {
  id: string;
  name: string;
  score: number; // Round score
  totalScore: number; // Cumulative score
  timeSpent: number;
  eliminated: boolean;
  board: Card[];
  ws: WebSocket;
  combo: number;
  skills: Record<string, number>;
  frozenUntil: number;
  shieldedUntil: number;
}

interface Card {
  id: number;
  value: string;
  flipped: boolean;
  matched: boolean;
}

interface GameState {
  players: { [id: string]: Omit<Player, "ws"> };
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

interface Room {
  id: string;
  players: { [id: string]: Player };
  gameState: GameState;
  timerInterval: NodeJS.Timeout | null;
}

let rooms: { [id: string]: Room } = {};

function broadcast(roomId: string, data: any) {
  const room = rooms[roomId];
  if (!room) return;
  const message = JSON.stringify(data);
  Object.values(room.players).forEach((p) => {
    if (p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(message);
    }
  });
}

function generateBoard(round: number, theme: string = "default") {
  const cardCounts = [16, 24, 32];
  const count = cardCounts[round - 1] || 16;
  const pairCount = count / 2;

  let allValues = [
    "🟥", "🟡", "🔺", "🔷", "⭐", "🌙", "🌀", "💠", 
    "🍀", "💎", "🍎", "🍕", "🚀", "🛸", "👾", "👻", 
    "🎃", "⚡", "🌈", "🔥", "❄️", "🌋", "🪐", "🦄",
    "🐉", "🦁", "🦊", "🐼", "🐨", "🐯", "🐸", "🐙"
  ];
  
  if (theme === "tech") {
    allValues = ["💻", "📱", "⌚", "🕹️", "⌨️", "🖱️", "🎮", "🔋", "🔌", "💾", "💿", "💡", "📡", "🔭", "🔬", "🚀", "🛸", "🛰️", "🤖", "⚙️", "🔧", "🧲", "🧬", "🧪", "🧫", "📺", "📻", "📷", "🎥"];
  } else if (theme === "animals") {
    allValues = ["🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐧", "🐦", "🐤", "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐜"];
  } else if (theme === "abstract") {
    allValues = ["🔺", "🔴", "🟦", "🟡", "🟩", "♦️", "🔷", "🔶", "🛑", "💠", "🔘", "🔳", "🔲", "〰️", "➰", "➖", "➕", "✖️", "➗", "🎵", "🎶", "♠️", "♣️", "♥️", "♦️", "⚪", "⚫", "🟤", "🟣", "🟠"];
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
}

function startRound(roomId: string, round: number) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);
  
  room.gameState.currentRound = round;
  room.gameState.started = true;
  room.gameState.status = "PLAYING";
  room.gameState.winner = null;
  room.gameState.time = round === 1 ? 50 : round === 2 ? 90 : 120;

  // Reset round scores and generate boards for each player
  Object.keys(room.players).forEach(id => {
    const p = room.players[id];
    const gsp = room.gameState.players[id];
    if (gsp) {
      gsp.timeSpent = 0;
      gsp.combo = 0;
      if (!gsp.eliminated) {
        p.board = generateBoard(round, room.gameState.theme);
        gsp.board = p.board;
      } else {
        p.board = [];
        gsp.board = [];
      }
    }
  });

  room.timerInterval = setInterval(() => {
    room.gameState.time--;
    
    // Increment timeSpent for active players who haven't finished their board
    Object.keys(room.players).forEach(id => {
      const gsp = room.gameState.players[id];
      if (gsp && !gsp.eliminated && !gsp.board.every(c => c.matched)) {
        gsp.timeSpent += 1;
      }
    });

    if (room.gameState.time <= 0) {
      endRound(roomId);
    } else {
      // Check if all active players have finished their boards
      const activePlayers = Object.values(room.gameState.players).filter(p => !p.eliminated);
      if (activePlayers.length > 0 && activePlayers.every(p => p.board.every(c => c.matched))) {
        endRound(roomId);
      }
    }
    broadcast(roomId, { type: "GAME_STATE", state: room.gameState });
  }, 1000);

  broadcast(roomId, { type: "GAME_STATE", state: room.gameState });
}

function endRound(roomId: string) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.timerInterval) clearInterval(room.timerInterval);
  room.gameState.status = "ROUND_END";
  
  // Update total scores
  Object.values(room.gameState.players).forEach(p => {
    p.totalScore += p.score;
  });

  const activePlayers = Object.values(room.gameState.players)
    .filter(p => !p.eliminated)
    .sort((a, b) => b.score - a.score || a.timeSpent - b.timeSpent);

  // Eliminate bottom 2 if more than 2 active players and not final round
  if (activePlayers.length > 2 && room.gameState.currentRound < room.gameState.totalRounds) {
    const toEliminate = activePlayers.slice(-2);
    toEliminate.forEach(p => {
      p.eliminated = true;
    });
    broadcast(roomId, { type: "ELIMINATION", eliminatedIds: toEliminate.map(p => p.id) });
  }

  // Check for tournament end
  if (room.gameState.currentRound >= room.gameState.totalRounds) {
    room.gameState.status = "TOURNAMENT_END";
    room.gameState.started = false;
    const sortedByTotal = Object.values(room.gameState.players).sort((a, b) => b.totalScore - a.totalScore);
    room.gameState.winner = sortedByTotal[0] ? sortedByTotal[0].name : "No one";
    broadcast(roomId, { type: "GAME_OVER", winner: room.gameState.winner });
  }

  broadcast(roomId, { type: "GAME_STATE", state: room.gameState });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    const id = Math.random().toString(36).substring(7);
    let currentRoomId: string | null = null;

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "JOIN":
          const roomId = message.roomId || "LOBBY";
          currentRoomId = roomId;
          
          if (!rooms[roomId]) {
            rooms[roomId] = {
              id: roomId,
              players: {},
              gameState: {
                players: {},
                time: 50,
                started: false,
                winner: null,
                currentRound: 1,
                totalRounds: 3,
                adminId: id,
                status: "WAITING",
                theme: "default",
                skin: "default"
              },
              timerInterval: null
            };
          }

          const room = rooms[roomId];
          
          room.players[id] = { 
            id, 
            name: message.name, 
            score: 0, 
            totalScore: 0, 
            timeSpent: 0, 
            eliminated: false, 
            board: [],
            ws,
            combo: 0,
            skills: { peek: 0, freeze: 0, shield: 0, shuffle: 0 },
            frozenUntil: 0,
            shieldedUntil: 0
          };
          room.gameState.players[id] = { 
            id, 
            name: message.name, 
            score: 0, 
            totalScore: 0, 
            timeSpent: 0, 
            eliminated: false,
            board: [],
            combo: 0,
            skills: { peek: 0, freeze: 0, shield: 0, shuffle: 0 },
            frozenUntil: 0,
            shieldedUntil: 0
          };
          
          ws.send(JSON.stringify({ type: "JOIN_SUCCESS", id, roomId }));
          broadcast(roomId, { type: "GAME_STATE", state: room.gameState });
          break;

        case "START_GAME":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const startRoom = rooms[currentRoomId];
          if (startRoom.gameState.adminId !== id) return;
          // Reset tournament
          Object.values(startRoom.gameState.players).forEach(p => {
            p.totalScore = 0;
            p.eliminated = false;
          });
          startRound(currentRoomId, 1);
          break;

        case "NEXT_ROUND":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const nextRoomObj = rooms[currentRoomId];
          if (nextRoomObj.gameState.adminId !== id) return;
          if (nextRoomObj.gameState.status === "ROUND_END" && nextRoomObj.gameState.currentRound < nextRoomObj.gameState.totalRounds) {
            startRound(currentRoomId, nextRoomObj.gameState.currentRound + 1);
          }
          break;

        case "CHANGE_THEME":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const themeRoom = rooms[currentRoomId];
          if (themeRoom.gameState.adminId === id) {
            themeRoom.gameState.theme = message.theme;
            broadcast(currentRoomId, { type: "GAME_STATE", state: themeRoom.gameState });
          }
          break;

        case "CHANGE_SKIN":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const skinRoom = rooms[currentRoomId];
          if (skinRoom.gameState.adminId === id) {
            skinRoom.gameState.skin = message.skin;
            broadcast(currentRoomId, { type: "GAME_STATE", state: skinRoom.gameState });
          }
          break;

        case "FLIP_CARD":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const flipRoom = rooms[currentRoomId];
          const gsp = flipRoom.gameState.players[id];
          if (!flipRoom.gameState.started || !gsp || gsp.eliminated || flipRoom.gameState.status !== "PLAYING") return;
          if (gsp.frozenUntil > Date.now()) return;
          
          const playerBoard = gsp.board;
          const currentlyFlipped = playerBoard.filter(c => c.flipped && !c.matched);
          if (currentlyFlipped.length >= 2) return;

          const card = playerBoard[message.cardId];
          if (!card || card.flipped || card.matched) return;

          card.flipped = true;
          const flippedCards = playerBoard.filter(c => c.flipped && !c.matched);

          if (flippedCards.length === 2) {
            broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
            setTimeout(() => {
              const checkFlipped = playerBoard.filter(c => c.flipped && !c.matched);
              if (checkFlipped.length !== 2) return;

              if (checkFlipped[0].value === checkFlipped[1].value) {
                checkFlipped[0].matched = true;
                checkFlipped[1].matched = true;
                gsp.combo += 1;
                gsp.score += (10 + gsp.combo * 5);
                
                if (Math.random() < 0.3) {
                  const abilities = ["peek", "freeze", "shield", "shuffle"];
                  const granted = abilities[Math.floor(Math.random() * abilities.length)];
                  gsp.skills[granted] = (gsp.skills[granted] || 0) + 1;
                  ws.send(JSON.stringify({ type: "SKILL_GAINED", skill: granted }));
                }

                ws.send(JSON.stringify({ type: "MATCH_FOUND", playerId: id, combo: gsp.combo }));
              } else {
                checkFlipped[0].flipped = false;
                checkFlipped[1].flipped = false;
                gsp.combo = 0;
                ws.send(JSON.stringify({ type: "MISMATCH" }));
              }
              broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
            }, 1000);
          } else {
            broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
          }
          break;

        case "USE_SKILL":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const skillRoom = rooms[currentRoomId];
          const skillPlayer = skillRoom.gameState.players[id];
          if (!skillRoom.gameState.started || !skillPlayer || skillPlayer.eliminated || skillRoom.gameState.status !== "PLAYING") return;
          
          const { skill } = message;
          if (!skillPlayer.skills[skill] || skillPlayer.skills[skill] <= 0) return;

          skillPlayer.skills[skill]--;

          const now = Date.now();

          if (skill === "peek") {
            ws.send(JSON.stringify({ type: "SKILL_ACTIVATED", skill: "peek" }));
          } else if (skill === "freeze") {
            const opponents = Object.values(skillRoom.gameState.players).filter(p => !p.eliminated && p.id !== id);
            const vulnerable = opponents.filter(p => p.shieldedUntil < now);
            if (vulnerable.length > 0) {
              const target = vulnerable[Math.floor(Math.random() * vulnerable.length)];
              target.frozenUntil = now + 5000;
              const targetWs = rooms[currentRoomId].players[target.id].ws;
              targetWs.send(JSON.stringify({ type: "FROZEN_BY", by: skillPlayer.name }));
              ws.send(JSON.stringify({ type: "SKILL_ACTIVATED", skill: "freeze", target: target.name }));
            }
          } else if (skill === "shield") {
            skillPlayer.shieldedUntil = now + 10000;
            ws.send(JSON.stringify({ type: "SKILL_ACTIVATED", skill: "shield" }));
          } else if (skill === "shuffle") {
            const opponents = Object.values(skillRoom.gameState.players).filter(p => !p.eliminated && p.id !== id);
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
              const targetWs = rooms[currentRoomId].players[target.id].ws;
              targetWs.send(JSON.stringify({ type: "SHUFFLED_BY", by: skillPlayer.name }));
              ws.send(JSON.stringify({ type: "SKILL_ACTIVATED", skill: "shuffle", target: target.name }));
            }
          }
          broadcast(currentRoomId, { type: "GAME_STATE", state: skillRoom.gameState });
          break;
      }
    });

    ws.on("close", () => {
      if (currentRoomId && rooms[currentRoomId]) {
        const room = rooms[currentRoomId];
        delete room.players[id];
        delete room.gameState.players[id];
        
        if (room.gameState.adminId === id) {
          const remainingIds = Object.keys(room.players);
          room.gameState.adminId = remainingIds.length > 0 ? remainingIds[0] : null;
        }

        if (Object.keys(room.players).length === 0) {
          if (room.timerInterval) clearInterval(room.timerInterval);
          delete rooms[currentRoomId];
        } else {
          broadcast(currentRoomId, { type: "GAME_STATE", state: room.gameState });
        }
      }
    });
  });
}

startServer();

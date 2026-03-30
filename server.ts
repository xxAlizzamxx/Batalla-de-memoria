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

function generateBoard(round: number) {
  const cardCounts = [16, 24, 32];
  const count = cardCounts[round - 1] || 16;
  const pairCount = count / 2;

  const allValues = [
    "🟥", "🟡", "🔺", "🔷", "⭐", "🌙", "🌀", "💠", 
    "🍀", "💎", "🍎", "🍕", "🚀", "🛸", "👾", "👻", 
    "🎃", "⚡", "🌈", "🔥", "❄️", "🌋", "🪐", "🦄",
    "🐉", "🦁", "🦊", "🐼", "🐨", "🐯", "🐸", "🐙"
  ];
  
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
      gsp.score = 0;
      gsp.timeSpent = 0;
      if (!gsp.eliminated) {
        p.board = generateBoard(round);
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
            ws 
          };
          room.gameState.players[id] = { 
            id, 
            name: message.name, 
            score: 0, 
            totalScore: 0, 
            timeSpent: 0, 
            eliminated: false,
            board: []
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

        case "FLIP_CARD":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const flipRoom = rooms[currentRoomId];
          const gsp = flipRoom.gameState.players[id];
          if (!flipRoom.gameState.started || !gsp || gsp.eliminated || flipRoom.gameState.status !== "PLAYING") return;
          
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
                gsp.score += 1;
                
                ws.send(JSON.stringify({ type: "MATCH_FOUND", playerId: id }));
              } else {
                checkFlipped[0].flipped = false;
                checkFlipped[1].flipped = false;
                ws.send(JSON.stringify({ type: "MISMATCH" }));
              }
              broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
            }, 1000);
          } else {
            broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
          }
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

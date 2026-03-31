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
  photoURL?: string | null;
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
  theme: string;
  skin: string;
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
  players: { [id: string]: Omit<Player, "ws"> };
  teams?: { [teamId: string]: Team };
  mode: GameMode;
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

  // Reset round scores and generate boards for each player or team
  if (room.gameState.mode === "TEAMS" && room.gameState.teams) {
    // Si el modo es equipos, gestionamos los equipos
    Object.values(room.gameState.teams).forEach(t => {
      t.score = 0;
      const firstPlayerTheme = room.gameState.players[t.playerIds[0]]?.theme || "default";
      t.board = generateBoard(round, firstPlayerTheme);
      // Reset turn to first player
      t.currentTurn = t.playerIds[0]; // Establecer el primer jugador como el que tiene el turno
    });
  }

  // Reset player time spent for tracking and individual boards
  Object.keys(room.players).forEach(id => {
    const p = room.players[id];
    const gsp = room.gameState.players[id];
    if (gsp) {
      // Reset timeSpent, combo, and score
      gsp.timeSpent = 0;
      gsp.combo = 0;
      gsp.score = 0;

      // Handle eliminated players and reset their board
      if (gsp.eliminated) {
        p.board = [];
        gsp.board = [];
      } else {
        p.board = generateBoard(round, gsp.theme);
        gsp.board = p.board;
        gsp.skills.peek = (gsp.skills.peek || 0) + 1; // Si el jugador no está eliminado, aumenta la habilidad
      }
    }
  });

  room.timerInterval = setInterval(() => {
    room.gameState.time--;

    if (room.gameState.mode === "TEAMS" && room.gameState.teams) {
      Object.keys(room.players).forEach(id => {
        const gsp = room.gameState.players[id];
        const team = Object.values(room.gameState.teams!).find(t => t.playerIds.includes(id));
        if (gsp && team && !team.board.every(c => c.matched)) {
          gsp.timeSpent += 1;
        }
      });

      if (room.gameState.time <= 0) {
        endRound(roomId);
      } else {
        const activeTeams = Object.values(room.gameState.teams);
        if (activeTeams.length > 0 && activeTeams.every(t => t.board.every(c => c.matched))) {
          endRound(roomId);
        }
      }
    } else {
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

  if (room.gameState.mode === "TEAMS" && room.gameState.teams) {
    Object.values(room.gameState.teams).forEach(t => {
      t.totalScore += t.score;
    });

    if (room.gameState.currentRound >= room.gameState.totalRounds) {
      room.gameState.status = "TOURNAMENT_END";
      room.gameState.started = false;
      const sortedTeams = Object.values(room.gameState.teams).sort((a, b) => b.totalScore - a.totalScore);
      room.gameState.winner = sortedTeams[0] ? sortedTeams[0].name : "Nadie";
      broadcast(roomId, { type: "GAME_OVER", winner: room.gameState.winner });
    }
  } else {
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
      room.gameState.winner = sortedByTotal[0] ? sortedByTotal[0].name : "Nadie";
      broadcast(roomId, { type: "GAME_OVER", winner: room.gameState.winner });
    }
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
          const photoURL = message.photoURL || null;
          currentRoomId = roomId;

          if (!rooms[roomId]) {
            rooms[roomId] = {
              id: roomId,
              players: {},
              gameState: {
                players: {},
                mode: "FFA",
                time: 50,
                started: false,
                winner: null,
                currentRound: 1,
                totalRounds: 3,
                adminId: id,
                status: "WAITING"
              },
              timerInterval: null
            };
          }

          const room = rooms[roomId];

          room.players[id] = {
            id,
            name: message.name,
            photoURL,
            score: 0,
            totalScore: 0,
            timeSpent: 0,
            eliminated: false,
            board: [],
            ws,
            combo: 0,
            skills: { peek: 0, freeze: 0, shield: 0, shuffle: 0 },
            frozenUntil: 0,
            shieldedUntil: 0,
            theme: "default",
            skin: "default"
          };
          room.gameState.players[id] = {
            id,
            name: message.name,
            photoURL,
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

          ws.send(JSON.stringify({ type: "JOIN_SUCCESS", id, roomId }));
          broadcast(roomId, { type: "GAME_STATE", state: room.gameState });
          break;

        case "START_GAME":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const startRoom = rooms[currentRoomId];
          if (startRoom.gameState.adminId !== id) return;

          startRoom.gameState.mode = message.mode || "FFA";

          if (startRoom.gameState.mode === "1V1" && Object.keys(startRoom.players).length !== 2) return;
          if (startRoom.gameState.mode === "TEAMS" && Object.keys(startRoom.players).length !== 4) return;

          if (startRoom.gameState.mode === "TEAMS") {
            const pIds = Object.keys(startRoom.players).sort(() => Math.random() - 0.5);
            startRoom.gameState.teams = {
              "TEAM_1": { id: "TEAM_1", name: "Equipo Rojo", playerIds: [pIds[0], pIds[1]], score: 0, totalScore: 0, board: [], currentTurn: pIds[0] },
              "TEAM_2": { id: "TEAM_2", name: "Equipo Azul", playerIds: [pIds[2], pIds[3]], score: 0, totalScore: 0, board: [], currentTurn: pIds[2] }
            }
          }

          // Reset tournament
          Object.values(startRoom.gameState.players).forEach(p => {
            p.totalScore = 0;
            p.eliminated = false;
          });
          if (startRoom.gameState.teams) {
            Object.values(startRoom.gameState.teams).forEach(t => { t.totalScore = 0; });
          }

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

        case "UPDATE_PREFS":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const prefsRoom = rooms[currentRoomId];
          const prefsP = prefsRoom.players[id];
          const prefsGsp = prefsRoom.gameState.players[id];
          if (prefsP && prefsGsp) {
            prefsP.theme = message.theme || prefsP.theme;
            prefsP.skin = message.skin || prefsP.skin;
            prefsGsp.theme = message.theme || prefsGsp.theme;
            prefsGsp.skin = message.skin || prefsGsp.skin;
            broadcast(currentRoomId, { type: "GAME_STATE", state: prefsRoom.gameState });
          }
          break;

        case "FLIP_CARD":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const flipRoom = rooms[currentRoomId];
          const mode = flipRoom.gameState.mode;
          let activeBoard: Card[] = [];
          let currentTeam: Team | undefined;

          const gsp = flipRoom.gameState.players[id];
          if (!flipRoom.gameState.started || !gsp || gsp.eliminated || flipRoom.gameState.status !== "PLAYING") return;
          if (gsp.frozenUntil > Date.now()) return;

          if (mode === "TEAMS" && flipRoom.gameState.teams) {
            currentTeam = Object.values(flipRoom.gameState.teams).find(t => t.playerIds.includes(id));
            if (!currentTeam || currentTeam.currentTurn !== id) return;
            activeBoard = currentTeam.board;
          } else {
            activeBoard = gsp.board;
          }

          const currentlyFlipped = activeBoard.filter(c => c.flipped && !c.matched);
          if (currentlyFlipped.length >= 2) return;

          const card = activeBoard[message.cardId];
          if (!card || card.flipped || card.matched) return;

          card.flipped = true;
          const flippedCards = activeBoard.filter(c => c.flipped && !c.matched);

          if (flippedCards.length === 2) {
            broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
            setTimeout(() => {
              const checkFlipped = activeBoard.filter(c => c.flipped && !c.matched);
              if (checkFlipped.length !== 2) return;

              if (checkFlipped[0].value === checkFlipped[1].value) {
                checkFlipped[0].matched = true;
                checkFlipped[1].matched = true;
                // Incrementar el combo y puntaje basado en el combo
                gsp.combo += 1;
                gsp.score += (10 + gsp.combo * 5);

                // Si el random está por debajo de 0.3 o el combo llega a 3, incrementar más
                if (Math.random() < 0.3 || gsp.combo >= 3) {
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

                // Lógica de turno para equipos
                if (mode === "TEAMS" && currentTeam) {
                  // Cambiar el turno al otro compañero de equipo
                  currentTeam.currentTurn = currentTeam.playerIds.find(p => p !== id) || id;
                }

                ws.send(JSON.stringify({ type: "MISMATCH" }));
              }
              broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
            }, 1000);
          } else {
            broadcast(currentRoomId, { type: "GAME_STATE", state: flipRoom.gameState });
          }

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

        case "SEND_EMOTE":
          if (!currentRoomId || !rooms[currentRoomId]) return;
          const emoteRoom = rooms[currentRoomId];
          if (!emoteRoom.gameState.players[id]) return;
          broadcast(currentRoomId, { type: "EMOTE_RECEIVED", playerId: id, emote: message.emote });
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

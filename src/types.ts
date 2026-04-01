import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export interface Player {
  id: string;
  name: string;
  photoURL?: string;
  score: number;
  totalScore: number;
  timeSpent: number;
  eliminated: boolean;
  board: Card[];
  combo: number;
  skills: Record<string, number>;
  frozenUntil: number;
  shieldedUntil: number;
  theme: string;
  skin: string;
  lastReaction?: string;
  reactionTime?: number;
}

export interface Card {
  id: number;
  value: string;
  flipped: boolean;
  matched: boolean;
  isStatic?: boolean;
}

export type GameMode = "FFA" | "1V1" | "TEAMS" | "CLASH";

export interface Team {
  id: string;
  name: string;
  playerIds: string[];
  score: number;
  totalScore: number;
  board: Card[];
  currentTurn: string;
}

export interface GameEvent {
  id?: number | string;
  type: string;
  playerId?: string;
  target?: string;
  skill?: string;
  by?: string;
  winner?: string;
  combo?: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  emotion?: string;
  timestamp: number;
}

export interface GameState {
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
  lastEvent?: GameEvent | null;
  messages?: ChatMessage[];
}

export interface Notification {
  id: number;
  message: string;
  type: "success" | "warning" | "info" | "error";
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

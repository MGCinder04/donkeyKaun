import type { RoomErrorCode } from "./types";

export const ROOM_ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  not_found: "No room with that code. Double-check with whoever's hosting.",
  full: "That room already has 6 players.",
  in_progress: "That game has already started.",
  invalid: "Enter a valid room code.",
  not_host: "Only the host can start the game.",
  cant_start: "Need at least 2 players to start.",
};

import type { RoomErrorCode } from "./types";

export const ROOM_ERROR_MESSAGES: Record<RoomErrorCode, string> = {
  not_found: "No room with that code. Double-check with whoever's hosting.",
  full: "That room already has 6 players.",
  in_progress: "That game has already started.",
  invalid: "Enter a valid room code.",
  not_host: "Only the host can do that.",
  cant_start: "Need at least 2 players to start.",
  not_playing: "This room isn't in a game right now.",
  wrong_phase: "That's not possible right now.",
  not_your_turn: "It's not your turn yet.",
  invalid_bid: "That's not a valid bid.",
  dealer_restricted: "That bid would make the total match the cards dealt — not allowed for the dealer.",
  not_your_card: "You don't have that card.",
  must_follow_suit: "You have to follow suit if you can.",
  kicked: "You were removed from this room and can't rejoin.",
};

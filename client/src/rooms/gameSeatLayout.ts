import { seatPosition, type SeatPosition } from "./seatLayout";

/** Positions seats around the table from the viewing player's own perspective — they're
 *  always at the bottom (6 o'clock), with everyone else carried around in the same
 *  relative order as the real, fixed seating circle. */
export function gameSeatPosition(seatIndex: number, mySeatIndex: number, total: number): SeatPosition {
  const mySlot = Math.round(total / 2);
  const offset = (seatIndex - mySeatIndex + total) % total;
  const displayIndex = (mySlot + offset) % total;
  return seatPosition(displayIndex, total);
}

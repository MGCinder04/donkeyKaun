import { seatPosition, type SeatPosition } from "./seatLayout";

/** Positions seats around the table from the viewing player's own perspective — they're
 *  always at the bottom (6 o'clock), with everyone else carried around in the same
 *  relative order as the real, fixed seating circle. */
function displayIndexFor(seatIndex: number, mySeatIndex: number, total: number): number {
  const mySlot = Math.round(total / 2);
  const offset = (seatIndex - mySeatIndex + total) % total;
  return (mySlot + offset) % total;
}

export function gameSeatPosition(seatIndex: number, mySeatIndex: number, total: number): SeatPosition {
  return seatPosition(displayIndexFor(seatIndex, mySeatIndex, total), total);
}

/** Where a card played by `seatIndex` comes to rest in the middle of the table — same
 *  angle as their seat, just closer to center, so the pile fans out toward whoever
 *  played each card. */
export function pileSlotPosition(seatIndex: number, mySeatIndex: number, total: number): SeatPosition {
  return seatPosition(displayIndexFor(seatIndex, mySeatIndex, total), total, 17, 16);
}

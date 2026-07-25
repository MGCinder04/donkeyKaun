export interface SeatPosition {
  top: string;
  left: string;
}

/** Positions `total` seats evenly around an oval, starting at the top and going clockwise —
 *  matches the fixed a→b→c→d→e→f play order the game rules describe. */
export function seatPosition(index: number, total: number): SeatPosition {
  const angle = -90 + (360 / total) * index;
  const radians = (angle * Math.PI) / 180;
  const radiusX = 44;
  const radiusY = 42;
  const left = 50 + radiusX * Math.cos(radians);
  const top = 50 + radiusY * Math.sin(radians);
  return { top: `${top}%`, left: `${left}%` };
}

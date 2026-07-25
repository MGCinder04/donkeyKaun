export interface SeatPosition {
  top: string;
  left: string;
}

/** Positions `total` seats evenly around an oval, starting at the top and going clockwise —
 *  matches the fixed a→b→c→d→e→f play order the game rules describe. `radiusX`/`radiusY`
 *  (as % of the container) default to the seat ring; pass smaller values to place something
 *  else — e.g. a played card's resting spot — along the same angle closer to the center. */
export function seatPosition(index: number, total: number, radiusX = 44, radiusY = 42): SeatPosition {
  const angle = -90 + (360 / total) * index;
  const radians = (angle * Math.PI) / 180;
  const left = 50 + radiusX * Math.cos(radians);
  const top = 50 + radiusY * Math.sin(radians);
  return { top: `${top}%`, left: `${left}%` };
}

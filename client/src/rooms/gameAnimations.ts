import { useEffect, useRef, useState } from "react";
import type { PublicGameState, Suit, TrickCard } from "./types";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
function rankValue(rank: string): number {
  return RANKS.indexOf(rank);
}

/** Mirrors the server's trick-resolution rule (engine.ts) so the client can figure out
 *  who just won a trick from public data alone, to animate the sweep toward them —
 *  the server has already moved on to the next trick/round by the time we'd otherwise
 *  find out. */
export function resolveTrickWinner(trick: TrickCard[], trumpSuit: Suit): string {
  const trumped = trick.filter((t) => t.card.suit === trumpSuit);
  const leadSuit = trick[0].card.suit;
  const pool = trumped.length > 0 ? trumped : trick.filter((t) => t.card.suit === leadSuit);
  return pool.reduce((best, t) => (rankValue(t.card.rank) > rankValue(best.card.rank) ? t : best)).deviceId;
}

function dealOrder(seatOrder: string[], dealerSeat: number): string[] {
  const n = seatOrder.length;
  const start = (dealerSeat + 1) % n;
  return seatOrder.slice(start).concat(seatOrder.slice(0, start));
}

export interface DealEvent {
  seatIndex: number;
  delay: number;
}

const DEAL_STAGGER_MS = 55;
const DEAL_FLIGHT_MS = 350;

/** Fires a round-robin sequence of "deal a card to this seat" events — one entry per
 *  card per player, in real deal order (left of dealer through to the dealer) — any
 *  time a fresh round starts. Detected by every bid being unset rather than by round
 *  number alone, so a mid-round page refresh doesn't replay the deal. */
export function useDealAnimation(game: PublicGameState): { dealing: boolean; dealEvents: DealEvent[] } {
  const [dealing, setDealing] = useState(false);
  const [dealEvents, setDealEvents] = useState<DealEvent[]>([]);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const freshRound = Object.values(game.bids).every((b) => b === null);
    if (!freshRound) return;

    const order = dealOrder(game.seatOrder, game.dealerSeat);
    const events: DealEvent[] = [];
    for (let c = 0; c < game.cardsThisRound; c++) {
      for (const deviceId of order) {
        events.push({ seatIndex: game.seatOrder.indexOf(deviceId), delay: events.length * DEAL_STAGGER_MS });
      }
    }
    setDealEvents(events);
    setDealing(true);
    const totalMs = events.length * DEAL_STAGGER_MS + DEAL_FLIGHT_MS;
    const timer = setTimeout(() => setDealing(false), totalMs);
    timersRef.current.push(timer);
    // Intentionally keyed on round only — re-running on every bid/play would replay
    // the deal mid-round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.round]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  return { dealing, dealEvents };
}

const SWEEP_PAUSE_MS = 550;
const SWEEP_FLIGHT_MS = 500;

export interface TrickAnimationState {
  displayTrick: TrickCard[];
  sweepWinnerSeat: number | null;
  sweeping: boolean;
}

/** The server clears a resolved trick instantly, but players need a beat to see the
 *  completed pile before it sweeps away — so this buffers `currentTrick` locally,
 *  holding the last full pile on screen and computing (client-side, via
 *  resolveTrickWinner) who to sweep it toward before syncing back to live state. */
export function useTrickAnimation(game: PublicGameState): TrickAnimationState {
  const [displayTrick, setDisplayTrick] = useState<TrickCard[]>(game.currentTrick);
  const [sweepWinnerSeat, setSweepWinnerSeat] = useState<number | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const prevRef = useRef(game);
  const latestRef = useRef(game);
  const sweepingRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  latestRef.current = game;

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = game;
    if (sweepingRef.current) return;

    const total = game.seatOrder.length;
    const trickJustResolved = prev.currentTrick.length === total && game.currentTrick.length < total;
    if (!trickJustResolved) {
      setDisplayTrick(game.currentTrick);
      return;
    }

    const winnerId = resolveTrickWinner(prev.currentTrick, prev.trumpSuit);
    const winnerSeat = prev.seatOrder.indexOf(winnerId);
    setDisplayTrick(prev.currentTrick);

    const pauseTimer = setTimeout(() => {
      setSweepWinnerSeat(winnerSeat);
      setSweeping(true);
      sweepingRef.current = true;
      const flightTimer = setTimeout(() => {
        sweepingRef.current = false;
        setSweeping(false);
        setSweepWinnerSeat(null);
        setDisplayTrick(latestRef.current.currentTrick);
      }, SWEEP_FLIGHT_MS);
      timersRef.current.push(flightTimer);
    }, SWEEP_PAUSE_MS);
    timersRef.current.push(pauseTimer);
  }, [game]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  return { displayTrick, sweepWinnerSeat, sweeping };
}

import { describe, expect, it } from "vitest";
import { cardId } from "../game/cards.js";
import { placeBid, playCard, resolvePendingTrick, startGame, type GameState } from "../game/engine.js";
import { BOT_KINDS, type BotKind } from "./types.js";
import { chooseBid, chooseCard, legalBids, viewForBot } from "./strategy.js";

function seededRng(seed: number): () => number {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function kindFor(id: string): BotKind {
  return BOT_KINDS[Number(id.slice(1)) % BOT_KINDS.length];
}

describe("bot information boundary", () => {
  it("never exposes an opponent hand to the strategy", () => {
    const state = startGame(["b0", "b1", "b2", "b3"], seededRng(7));
    const view = viewForBot(state, "b0", "bhola");
    expect(view.hand).toEqual(state.hands.b0);
    expect("hands" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain(cardId(state.hands.b1[0]));
  });
});

describe.each(BOT_KINDS)("%s bot", (kind) => {
  it("always chooses an allowed dealer bid", () => {
    let state = startGame(["b0", "b1", "b2"], seededRng(13));
    state = (placeBid(state, "b1", 3) as { ok: true; value: GameState }).value;
    state = (placeBid(state, "b2", 2) as { ok: true; value: GameState }).value;
    const view = viewForBot(state, "b0", kind);
    const bid = chooseBid(view);
    expect(legalBids(view)).toContain(bid);
    expect(placeBid(state, "b0", bid).ok).toBe(true);
  });

  it("always chooses a card from the legal set", () => {
    let state = startGame(["b0", "b1", "b2", "b3"], seededRng(21));
    for (const id of state.bidOrder) {
      const view = viewForBot(state, id, kind);
      state = (placeBid(state, id, chooseBid(view)) as { ok: true; value: GameState }).value;
    }
    for (let play = 0; play < 12; play += 1) {
      const id = state.seatOrder[state.turnSeat];
      const view = viewForBot(state, id, kind);
      const card = chooseCard(view);
      expect(view.legalCards.map(cardId)).toContain(cardId(card));
      const result = playCard(state, id, card, seededRng(22));
      expect(result.ok).toBe(true);
      state = (result as { ok: true; value: GameState }).value;
      if (state.currentTrick.length === state.seatOrder.length) state = resolvePendingTrick(state, seededRng(22));
      if (state.phase !== "trick") break;
    }
  });
});

describe("bot tournament", () => {
  it("finishes many complete eight-round games without an illegal action or deadlock", () => {
    const completed: Record<BotKind, number> = { bhola: 0, hisaabi: 0, shaitaan: 0, ustaad: 0 };
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = seededRng(seed);
      let state = startGame(["b0", "b1", "b2", "b3"], rng);
      let actions = 0;
      while (state.phase !== "game-end" && actions < 2_000) {
        if (state.phase === "bidding") {
          const id = state.bidOrder[state.bidTurnIndex];
          const result = placeBid(state, id, chooseBid(viewForBot(state, id, kindFor(id))));
          expect(result.ok).toBe(true);
          state = (result as { ok: true; value: GameState }).value;
        } else if (state.currentTrick.length === state.seatOrder.length) {
          state = resolvePendingTrick(state, rng);
        } else {
          const id = state.seatOrder[state.turnSeat];
          const result = playCard(state, id, chooseCard(viewForBot(state, id, kindFor(id))), rng);
          expect(result.ok).toBe(true);
          state = (result as { ok: true; value: GameState }).value;
        }
        actions += 1;
      }
      expect(state.phase).toBe("game-end");
      expect(actions).toBeLessThan(2_000);
      const best = Math.max(...Object.values(state.scores));
      for (const [id, score] of Object.entries(state.scores)) if (score === best) completed[kindFor(id)] += 1;
    }
    // Every personality must be capable of winning a fair deal; none is scripted to lose.
    for (const kind of BOT_KINDS) expect(completed[kind]).toBeGreaterThan(0);
  }, 30_000);
});

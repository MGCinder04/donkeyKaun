import { describe, expect, it } from "vitest";
import type { Card } from "./cards.js";
import { continueGame, legalCards, newGame, placeBid, playCard, startGame, type GameState } from "./engine.js";

/** Deterministic PRNG (mulberry32) so dealing is reproducible in tests. */
function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const c = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank });

describe("startGame", () => {
  it("deals the right number of cards, all unique, round 1 setup", () => {
    const seatOrder = ["p1", "p2", "p3", "p4"];
    const state = startGame(seatOrder, seededRng(1));

    expect(state.round).toBe(1);
    expect(state.cardsThisRound).toBe(8);
    expect(state.dealerSeat).toBe(0);
    expect(state.trumpSuit).toBe("S");
    expect(state.phase).toBe("bidding");
    expect(state.bidOrder).toEqual(["p2", "p3", "p4", "p1"]); // starts after dealer, ends with dealer

    for (const id of seatOrder) expect(state.hands[id]).toHaveLength(8);
    const allCards = Object.values(state.hands).flat();
    const unique = new Set(allCards.map((card) => `${card.suit}${card.rank}`));
    expect(unique.size).toBe(32);
  });
});

describe("bidding", () => {
  function biddingFixture(): GameState {
    const seatOrder = ["p1", "p2", "p3"];
    const bids: GameState["bids"] = { p1: null, p2: null, p3: null };
    const tricksWon = { p1: 0, p2: 0, p3: 0 };
    return {
      round: 1,
      cardsThisRound: 5,
      dealerSeat: 0, // p1 deals
      trumpSuit: "S",
      seatOrder,
      hands: { p1: [], p2: [], p3: [] },
      phase: "bidding",
      bids,
      bidOrder: ["p2", "p3", "p1"], // dealer (p1) bids last
      bidTurnIndex: 0,
      tricksWon,
      currentTrick: [],
      turnSeat: 0,
      scores: { p1: 0, p2: 0, p3: 0 },
      lastRoundSummary: null,
      roundHistory: [],
      donkeys: null,
    };
  }

  it("rejects bidding out of turn", () => {
    const state = biddingFixture();
    const result = placeBid(state, "p3", 2);
    expect(result).toEqual({ ok: false, error: "not_your_turn" });
  });

  it("rejects bids outside 0..cards+1", () => {
    const state = biddingFixture();
    expect(placeBid(state, "p2", -1)).toEqual({ ok: false, error: "invalid_bid" });
    expect(placeBid(state, "p2", 7)).toEqual({ ok: false, error: "invalid_bid" });
  });

  it("enforces the dealer restriction (screw-the-dealer)", () => {
    let state = biddingFixture();
    state = (placeBid(state, "p2", 2) as { ok: true; value: GameState }).value;
    state = (placeBid(state, "p3", 2) as { ok: true; value: GameState }).value;
    // othersSum = 4, cardsThisRound = 5 -> forbidden value for the dealer is 1
    expect(placeBid(state, "p1", 1)).toEqual({ ok: false, error: "dealer_restricted" });
    const allowed = placeBid(state, "p1", 0);
    expect(allowed.ok).toBe(true);
  });

  it("moves to the trick phase once everyone has bid", () => {
    let state = biddingFixture();
    state = (placeBid(state, "p2", 1) as { ok: true; value: GameState }).value;
    state = (placeBid(state, "p3", 1) as { ok: true; value: GameState }).value;
    const result = placeBid(state, "p1", 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phase).toBe("trick");
      expect(result.value.turnSeat).toBe(state.seatOrder.indexOf("p2")); // player after dealer leads
    }
  });
});

describe("trick play", () => {
  function trickFixture(): GameState {
    const seatOrder = ["p1", "p2", "p3"];
    return {
      round: 1,
      cardsThisRound: 2,
      dealerSeat: 0,
      trumpSuit: "C", // nobody holds a club in this fixture
      seatOrder,
      hands: {
        p1: [c("S", "A"), c("H", "2")],
        p2: [c("S", "K"), c("H", "A")],
        p3: [c("D", "2"), c("H", "K")],
      },
      phase: "trick",
      bids: { p1: 1, p2: 1, p3: 0 },
      bidOrder: ["p2", "p3", "p1"],
      bidTurnIndex: 3,
      tricksWon: { p1: 0, p2: 0, p3: 0 },
      currentTrick: [],
      turnSeat: 0, // p1 leads
      scores: { p1: 0, p2: 0, p3: 0 },
      lastRoundSummary: null,
      roundHistory: [],
      donkeys: null,
    };
  }

  it("must follow the led suit if able", () => {
    let state = trickFixture();
    state = (playCard(state, "p1", c("S", "A")) as { ok: true; value: GameState }).value;
    // p2 holds a spade (S-K), so playing the heart is illegal
    expect(playCard(state, "p2", c("H", "A"))).toEqual({ ok: false, error: "must_follow_suit" });
    expect(legalCards(state, "p2")).toEqual([c("S", "K")]);
  });

  it("lets a player discard/trump when they can't follow suit", () => {
    let state = trickFixture();
    state = (playCard(state, "p1", c("S", "A")) as { ok: true; value: GameState }).value;
    state = (playCard(state, "p2", c("S", "K")) as { ok: true; value: GameState }).value;
    // p3 has no spades — free to play either card
    expect(legalCards(state, "p3")).toEqual(state.hands.p3);
  });

  it("even the lowest trump beats the highest card of the led suit", () => {
    const state: GameState = {
      round: 1,
      cardsThisRound: 2,
      dealerSeat: 0,
      trumpSuit: "H",
      seatOrder: ["p1", "p2", "p3"],
      hands: {
        p1: [c("S", "A"), c("D", "2")],
        p2: [c("H", "2"), c("C", "3")], // no spades — free to trump
        p3: [c("S", "K"), c("D", "3")], // holds a spade — must follow suit
      },
      phase: "trick",
      bids: { p1: 0, p2: 0, p3: 0 },
      bidOrder: ["p2", "p3", "p1"],
      bidTurnIndex: 3,
      tricksWon: { p1: 0, p2: 0, p3: 0 },
      currentTrick: [],
      turnSeat: 0, // p1 leads
      scores: { p1: 0, p2: 0, p3: 0 },
      lastRoundSummary: null,
      roundHistory: [],
      donkeys: null,
    };

    let s = (playCard(state, "p1", c("S", "A")) as { ok: true; value: GameState }).value;
    expect(legalCards(s, "p2")).toEqual(s.hands.p2); // no spades, free to discard or trump
    s = (playCard(s, "p2", c("H", "2")) as { ok: true; value: GameState }).value; // trumps with the 2 of hearts
    const result = playCard(s, "p3", c("S", "K")) as { ok: true; value: GameState }; // highest spade, still loses
    expect(result.ok).toBe(true);
    expect(result.value.tricksWon).toEqual({ p1: 0, p2: 1, p3: 0 });
  });

  it("highest card of the led suit wins when no trump is played, and rolls the round into round 2", () => {
    let state = trickFixture();
    state = (playCard(state, "p1", c("S", "A")) as { ok: true; value: GameState }).value;
    state = (playCard(state, "p2", c("S", "K")) as { ok: true; value: GameState }).value;
    let afterTrick1 = playCard(state, "p3", c("H", "K")) as { ok: true; value: GameState };
    expect(afterTrick1.ok).toBe(true);
    state = afterTrick1.value;
    expect(state.tricksWon.p1).toBe(1); // S-A beat S-K; the discarded H-K never contested
    expect(state.turnSeat).toBe(state.seatOrder.indexOf("p1")); // trick winner leads next

    state = (playCard(state, "p1", c("H", "2")) as { ok: true; value: GameState }).value;
    const afterTrick2 = playCard(state, "p2", c("H", "A")) as { ok: true; value: GameState };
    state = afterTrick2.value;
    const final = playCard(state, "p3", c("D", "2")) as { ok: true; value: GameState };
    expect(final.ok).toBe(true);
    state = final.value;

    // p2 won trick 2 (H-A beats H-2; p3's D-2 discard never contested)
    // p1 bid 1, won 1 -> exact -> (1+1)*10+1 = 21
    // p2 bid 1, won 1 -> exact -> 21
    // p3 bid 0, won 0 -> exact -> 10
    expect(state.lastRoundSummary).toEqual({
      round: 1,
      trumpSuit: "C",
      results: [
        { deviceId: "p1", bid: 1, tricksWon: 1, roundScore: 21 },
        { deviceId: "p2", bid: 1, tricksWon: 1, roundScore: 21 },
        { deviceId: "p3", bid: 0, tricksWon: 0, roundScore: 10 },
      ],
    });
    expect(state.scores).toEqual({ p1: 21, p2: 21, p3: 10 });
    expect(state.roundHistory).toEqual([state.lastRoundSummary]); // scoresheet accumulates completed rounds

    // rolled into round 2
    expect(state.phase).toBe("bidding");
    expect(state.round).toBe(2);
    expect(state.cardsThisRound).toBe(7);
    expect(state.dealerSeat).toBe(1); // rotated one seat
    expect(state.trumpSuit).toBe("H"); // rotated one step
  });

  it("scores a missed bid as just the bid value, and settles the game after round 8", () => {
    const state: GameState = {
      round: 8,
      cardsThisRound: 1,
      dealerSeat: 0,
      trumpSuit: "D", // nobody holds a diamond
      seatOrder: ["p1", "p2", "p3"],
      hands: { p1: [c("S", "A")], p2: [c("S", "K")], p3: [c("H", "2")] },
      phase: "trick",
      bids: { p1: 0, p2: 0, p3: 1 },
      bidOrder: ["p2", "p3", "p1"],
      bidTurnIndex: 3,
      tricksWon: { p1: 0, p2: 0, p3: 0 },
      currentTrick: [],
      turnSeat: 0, // p1 leads
      scores: { p1: 100, p2: 50, p3: 50 },
      lastRoundSummary: null,
      roundHistory: [],
      donkeys: null,
    };

    let s = (playCard(state, "p1", c("S", "A")) as { ok: true; value: GameState }).value;
    s = (playCard(s, "p2", c("S", "K")) as { ok: true; value: GameState }).value;
    const result = playCard(s, "p3", c("H", "2")) as { ok: true; value: GameState };
    expect(result.ok).toBe(true);
    s = result.value;

    // p1 wins the only trick (S-A beats S-K); bid 0, won 1 -> mismatch -> score = bid = 0
    // p2 bid 0, won 0 -> exact -> 10
    // p3 bid 1, won 0 -> mismatch -> score = bid = 1
    expect(s.phase).toBe("game-end");
    expect(s.scores).toEqual({ p1: 100, p2: 60, p3: 51 });
    expect(s.donkeys).toEqual(["p3"]); // lowest cumulative score
    expect(s.roundHistory).toEqual([s.lastRoundSummary]); // round 8 lands in the sheet too
  });
});

describe("end of game", () => {
  function gameEndFixture(): GameState {
    const seatOrder = ["p1", "p2", "p3", "p4", "p5", "p6"];
    return {
      round: 8,
      cardsThisRound: 1,
      dealerSeat: 2,
      trumpSuit: "D",
      seatOrder,
      hands: Object.fromEntries(seatOrder.map((id) => [id, []])),
      phase: "game-end",
      bids: Object.fromEntries(seatOrder.map((id) => [id, 0])),
      bidOrder: seatOrder,
      bidTurnIndex: 6,
      tricksWon: Object.fromEntries(seatOrder.map((id) => [id, 0])),
      currentTrick: [],
      turnSeat: 0,
      scores: { p1: 80, p2: 40, p3: 60, p4: 40, p5: 90, p6: 30 },
      lastRoundSummary: null,
      roundHistory: [{ round: 7, trumpSuit: "C", results: [] }], // a prior game's sheet — should not carry over
      donkeys: ["p6"],
    };
  }

  it("new game resets scores and restarts dealing from seat 0 with trump reset", () => {
    const state = newGame(gameEndFixture(), seededRng(2));
    expect(state.round).toBe(1);
    expect(state.cardsThisRound).toBe(8);
    expect(state.dealerSeat).toBe(0);
    expect(state.trumpSuit).toBe("S");
    expect(Object.values(state.scores).every((s) => s === 0)).toBe(true);
    expect(state.roundHistory).toEqual([]); // fresh scoresheet
    expect(state.phase).toBe("bidding");
  });

  it("continue keeps cumulative scores and rotates the dealer onward", () => {
    const before = gameEndFixture();
    const state = continueGame(before, seededRng(3));
    expect(state.round).toBe(1);
    expect(state.cardsThisRound).toBe(8);
    expect(state.dealerSeat).toBe(3); // one past the previous dealer (seat 2)
    expect(state.trumpSuit).toBe("S");
    expect(state.scores).toEqual(before.scores);
    expect(state.roundHistory).toEqual([]); // fresh scoresheet even though scores carry over
    expect(state.phase).toBe("bidding");
  });
});

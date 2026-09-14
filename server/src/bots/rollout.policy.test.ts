import { describe, expect, it } from "vitest";
import { cardId, type Card, type Suit } from "../game/cards.js";
import { chooseRolloutCard, quickBidForRollout, type RolloutActorView } from "./advancedRollout.js";

function c(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function actor(overrides: Partial<RolloutActorView> = {}): RolloutActorView {
  const hand = overrides.hand ?? [c("S", "A"), c("H", "2")];
  return {
    actorId: "bot",
    kind: "ustaad",
    hand,
    bid: 1,
    won: 0,
    bids: { p1: 1, bot: 1, p3: 0 },
    tricksWon: { p1: 0, bot: 0, p3: 0 },
    scores: { p1: 0, bot: 0, p3: 0 },
    trick: [],
    playedCards: [],
    voidSuits: { p1: [], bot: [], p3: [] },
    handCounts: { p1: hand.length, bot: hand.length, p3: hand.length },
    seatOrder: ["p1", "bot", "p3"],
    turnSeat: 1,
    trumpSuit: "S",
    cardsThisRound: hand.length,
    ...overrides,
  };
}

describe("lightweight rollout bidding model", () => {
  it("counts a contiguous run of top trumps as an inviolable floor", () => {
    const hand = [c("S", "A"), c("S", "K"), c("S", "Q"), c("H", "2"), c("C", "4"), c("D", "6")];
    expect(quickBidForRollout(hand, "S", 6, { playerCount: 6 })).toBeGreaterThanOrEqual(3);
  });

  it("does not become more aggressive when earlier bids signal strong opponents", () => {
    const hand = [c("D", "K"), c("D", "Q"), c("H", "A"), c("C", "9"), c("S", "2")];
    const lowTable = quickBidForRollout(hand, "D", 5, { playerCount: 6, priorBids: [0, 0, 0] });
    const strongTable = quickBidForRollout(hand, "D", 5, { playerCount: 6, priorBids: [2, 2, 1] });
    expect(strongTable).toBeLessThanOrEqual(lowTable);
  });
});

describe("contract-aware rollout play", () => {
  it("uses the cheapest winning follower when it still needs hands", () => {
    const hand = [c("H", "A"), c("H", "J"), c("S", "2")];
    const choice = chooseRolloutCard(actor({
      hand,
      bid: 2,
      trick: [{ deviceId: "p1", card: c("H", "8") }],
      seatOrder: ["p1", "bot"],
      turnSeat: 1,
      bids: { p1: 0, bot: 2 },
      tricksWon: { p1: 0, bot: 0 },
      scores: { p1: 0, bot: 0 },
      voidSuits: { p1: [], bot: [] },
      handCounts: { p1: 2, bot: 3 },
    }));
    expect(cardId(choice)).toBe("HJ");
  });

  it("sheds the strongest certain loser after reaching its bid", () => {
    const hand = [c("S", "Q"), c("D", "Q"), c("C", "2")];
    const choice = chooseRolloutCard(actor({
      hand,
      bid: 1,
      won: 1,
      trick: [{ deviceId: "p1", card: c("H", "10") }],
      seatOrder: ["p1", "bot"],
      turnSeat: 1,
      bids: { p1: 1, bot: 1 },
      tricksWon: { p1: 0, bot: 1 },
      scores: { p1: 0, bot: 0 },
      voidSuits: { p1: [], bot: ["H" as Suit] },
      handCounts: { p1: 2, bot: 3 },
    }));
    expect(cardId(choice)).toBe("DQ");
  });

  it("leads the cheapest controlled trump to drain the table", () => {
    const hand = [c("S", "A"), c("S", "K"), c("S", "Q"), c("H", "A"), c("H", "K")];
    const choice = chooseRolloutCard(actor({
      hand,
      bid: 5,
      cardsThisRound: 5,
      handCounts: { p1: 5, bot: 5, p3: 5 },
    }));
    expect(cardId(choice)).toBe("SQ");
  });
});

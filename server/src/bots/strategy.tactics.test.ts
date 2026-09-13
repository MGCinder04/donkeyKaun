import { describe, expect, it } from "vitest";
import { cardId, type Card } from "../game/cards.js";
import { playCard, startGame, type GameState } from "../game/engine.js";
import { analyzeBotHand, chooseBid, chooseCard, type BotView } from "./strategy.js";
import { BOT_KINDS, type BotKind } from "./types.js";
import {
  observedBidWeight,
  projectRemainingBids,
  rolloutBidEstimates,
  sampleOpponentHands,
} from "./rollout.js";

function c(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function view(overrides: Partial<BotView> = {}): BotView {
  const hand = overrides.hand ?? [c("S", "A"), c("D", "2")];
  return {
    botId: "bot",
    kind: "ustaad",
    hand,
    legalCards: overrides.legalCards ?? hand,
    round: 1,
    cardsThisRound: hand.length,
    trumpSuit: "S",
    dealerDeviceId: "p3",
    seatOrder: ["bot", "p2", "p3"],
    turnSeat: 0,
    phase: "bidding",
    bids: { bot: null, p2: null, p3: null },
    tricksWon: { bot: 0, p2: 0, p3: 0 },
    currentTrick: [],
    playedCards: [],
    historyComplete: true,
    voidSuits: { bot: [], p2: [], p3: [] },
    handCounts: { bot: hand.length, p2: hand.length, p3: hand.length },
    scores: { bot: 0, p2: 0, p3: 0 },
    ...overrides,
  };
}

describe("bot bidding intelligence", () => {
  it.each(BOT_KINDS)("%s never lets a two poison an ace-of-trump bid", (kind: BotKind) => {
    const botView = view({ kind, hand: [c("S", "A"), c("D", "2")], cardsThisRound: 2 });
    const bid = chooseBid(botView);
    expect(Number.isFinite(bid)).toBe(true);
    expect(bid).toBeGreaterThanOrEqual(1);
  });

  it("recognizes a king as guaranteed after the higher trump has been played", () => {
    const botView = view({
      hand: [c("S", "K"), c("D", "2")],
      playedCards: [{ handNumber: 1, deviceId: "p2", card: c("S", "A"), leadSuit: "S" }],
    });
    const analysis = analyzeBotHand(botView);
    expect(analysis.guaranteedTrumpHands).toBe(1);
    expect(analysis.probabilities.find((item) => cardId(item.card) === "SK")?.chance).toBe(1);
  });
});

describe("bot contract protection", () => {
  it("does not lead the trump ace after bidding zero when a losing lead exists", () => {
    const botView = view({
      phase: "trick",
      bids: { bot: 0, p2: 1, p3: 0 },
      hand: [c("S", "A"), c("D", "2")],
      legalCards: [c("S", "A"), c("D", "2")],
    });
    expect(cardId(chooseCard(botView))).toBe("D2");
  });

  it("uses the weakest sufficient winner when playing last", () => {
    const botView = view({
      phase: "trick",
      seatOrder: ["p2", "bot"],
      turnSeat: 1,
      bids: { bot: 2, p2: 0 },
      tricksWon: { bot: 0, p2: 0 },
      hand: [c("S", "A"), c("S", "9")],
      legalCards: [c("S", "A"), c("S", "9")],
      currentTrick: [{ deviceId: "p2", card: c("S", "8") }],
      voidSuits: { bot: [], p2: [] },
      handCounts: { bot: 2, p2: 1 },
      scores: { bot: 0, p2: 0 },
    });
    expect(cardId(chooseCard(botView))).toBe("S9");
  });

  it("discards the strongest card that is still certain to lose after reaching its bid", () => {
    const botView = view({
      phase: "trick",
      seatOrder: ["p2", "bot"],
      turnSeat: 1,
      bids: { bot: 0, p2: 1 },
      tricksWon: { bot: 0, p2: 0 },
      hand: [c("S", "9"), c("S", "2")],
      legalCards: [c("S", "9"), c("S", "2")],
      currentTrick: [{ deviceId: "p2", card: c("S", "10") }],
      voidSuits: { bot: [], p2: [] },
      handCounts: { bot: 2, p2: 1 },
      scores: { bot: 0, p2: 0 },
    });
    expect(cardId(chooseCard(botView))).toBe("S9");
  });
});

describe("complete public card memory", () => {
  it("records every card immediately and infers a failed follow suit", () => {
    let state = startGame(["p1", "p2"], () => 0.42);
    state = {
      ...state,
      phase: "trick",
      turnSeat: 0,
      hands: { p1: [c("S", "7")], p2: [c("H", "4")] },
      bids: { p1: 1, p2: 0 },
      bidTurnIndex: 2,
    } as GameState;
    state = (playCard(state, "p1", c("S", "7")) as { ok: true; value: GameState }).value;
    expect(state.playHistory.plays).toEqual([
      { handNumber: 1, deviceId: "p1", card: c("S", "7"), leadSuit: "S" },
    ]);
    state = (playCard(state, "p2", c("H", "4")) as { ok: true; value: GameState }).value;
    expect(state.playHistory.plays).toHaveLength(2);
    expect(state.voidSuits.p2).toContain("S");
  });
});

describe("fair hidden-hand rollouts", () => {
  it("projects every remaining bid in order and obeys the dealer restriction", () => {
    const botView = view({
      botId: "bot",
      dealerDeviceId: "p3",
      seatOrder: ["bot", "p2", "p3"],
      cardsThisRound: 2,
      bids: { bot: null, p2: null, p3: null },
    });
    const projected = projectRemainingBids(botView, {
      bot: botView.hand,
      p2: [c("H", "A"), c("D", "2")],
      p3: [c("C", "A"), c("C", "K")],
    }, 1);

    expect(Object.keys(projected)).toHaveLength(3);
    expect(projected.p3).not.toBe(botView.cardsThisRound - projected.bot - projected.p2);
  });

  it("repairs an illegal supplied dealer bid in diagnostic simulations", () => {
    const botView = view({
      botId: "p3",
      dealerDeviceId: "p3",
      seatOrder: ["bot", "p2", "p3"],
      cardsThisRound: 2,
      bids: { bot: 1, p2: 0, p3: null },
    });
    const projected = projectRemainingBids(botView, {
      bot: [c("D", "2"), c("D", "3")],
      p2: [c("C", "2"), c("C", "3")],
      p3: botView.hand,
    }, 1);

    expect(projected.p3).not.toBe(1);
  });

  it("reconstructs already-played winners when conditioning on an observed bid", () => {
    const hands = {
      bot: [c("D", "2"), c("D", "3")],
      p2: [c("C", "2")],
      p3: [c("H", "2")],
    };
    const base = view({
      hand: hands.bot,
      seatOrder: ["bot", "p2", "p3"],
      bids: { bot: 0, p2: 2, p3: 0 },
      handCounts: { bot: 2, p2: 1, p3: 1 },
    });
    const afterTrumpAce = view({
      ...base,
      playedCards: [{ handNumber: 1, deviceId: "p2", card: c("S", "A"), leadSuit: "S" }],
    });

    expect(observedBidWeight(afterTrumpAce, hands)).toBeGreaterThan(observedBidWeight(base, hands));
  });

  it("reports effective rather than nominal rollout sample size", () => {
    const estimates = rolloutBidEstimates(view(), [0, 1, 2], 6);
    for (const estimate of estimates.values()) {
      expect(estimate.acceptedSamples).toBeGreaterThanOrEqual(6);
      expect(estimate.effectiveSamples).toBeGreaterThan(0);
      expect(estimate.effectiveSamples).toBeLessThanOrEqual(estimate.acceptedSamples);
    }
  });

  it("samples hands that respect severe publicly-known suit voids", () => {
    const botView = view({
      hand: [c("S", "A"), c("H", "A")],
      legalCards: [c("S", "A"), c("H", "A")],
      voidSuits: { bot: [], p2: ["S", "H", "C"], p3: [] },
      handCounts: { bot: 2, p2: 2, p3: 2 },
    });

    for (let sample = 0; sample < 20; sample += 1) {
      const deal = sampleOpponentHands(botView, sample);
      expect(deal).not.toBeNull();
      expect(deal?.hands.p2).toHaveLength(2);
      expect(deal?.hands.p2.every((card) => card.suit === "D")).toBe(true);
    }
  });
});

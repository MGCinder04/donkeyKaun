import { describe, expect, it } from "vitest";
import { cardId, type Card } from "../game/cards.js";
import { startGame, type GameState } from "../game/engine.js";
import { chooseBid, chooseCard, viewForBot, type BotView } from "./strategy.js";
import { BOT_KINDS, type BotKind } from "./types.js";

function c(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function view(overrides: Partial<BotView> = {}): BotView {
  const hand = overrides.hand ?? [c("S", "A"), c("H", "8"), c("D", "2")];
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

describe("advanced bid safeguards", () => {
  it.each(BOT_KINDS)("%s never bids below a contiguous run of top trumps", (kind: BotKind) => {
    const botView = view({
      kind,
      hand: [c("S", "A"), c("S", "K"), c("S", "Q"), c("H", "2"), c("C", "4"), c("D", "6")],
      cardsThisRound: 6,
      handCounts: { bot: 6, p2: 6, p3: 6 },
    });
    expect(chooseBid(botView)).toBeGreaterThanOrEqual(3);
  });

  it("moves a dealer upward when the exact guaranteed bid is forbidden", () => {
    const botView = view({
      botId: "bot",
      dealerDeviceId: "bot",
      seatOrder: ["p2", "p3", "bot"],
      kind: "ustaad",
      hand: [c("S", "A"), c("S", "K"), c("H", "2"), c("D", "2")],
      cardsThisRound: 4,
      bids: { p2: 1, p3: 1, bot: null },
      handCounts: { p2: 4, p3: 4, bot: 4 },
      voidSuits: { p2: [], p3: [], bot: [] },
      scores: { p2: 0, p3: 0, bot: 0 },
    });
    const bid = chooseBid(botView);
    expect(bid).not.toBe(2);
    expect(bid).toBeGreaterThan(2);
  });
});

describe("fair-information search boundary", () => {
  it("cannot change its move when only two opponents' hidden hands are swapped", () => {
    const base = startGame(["bot", "p2", "p3"], () => 0.37);
    const stateA: GameState = {
      ...base,
      phase: "trick",
      cardsThisRound: 2,
      trumpSuit: "S",
      hands: {
        bot: [c("S", "A"), c("H", "8")],
        p2: [c("S", "K"), c("D", "2")],
        p3: [c("H", "A"), c("C", "2")],
      },
      bids: { bot: 1, p2: 1, p3: 0 },
      bidOrder: ["bot", "p2", "p3"],
      bidTurnIndex: 3,
      tricksWon: { bot: 0, p2: 0, p3: 0 },
      currentTrick: [],
      playHistory: { complete: true, plays: [] },
      voidSuits: { bot: [], p2: [], p3: [] },
      turnSeat: 0,
    };
    const stateB: GameState = {
      ...stateA,
      hands: { bot: stateA.hands.bot, p2: stateA.hands.p3, p3: stateA.hands.p2 },
    };

    const firstView = viewForBot(stateA, "bot", "ustaad");
    const secondView = viewForBot(stateB, "bot", "ustaad");
    expect(firstView).toEqual(secondView);
    expect(cardId(chooseCard(firstView))).toBe(cardId(chooseCard(secondView)));
  });
});

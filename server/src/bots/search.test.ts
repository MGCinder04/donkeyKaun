import { describe, expect, it } from "vitest";
import { cardId, createDeck, type Card } from "../game/cards.js";
import type { PlayedCardEvent } from "../game/engine.js";
import { searchBestCard } from "./search.js";
import type { BotView } from "./strategy.js";

function card(suit: Card["suit"], rank: Card["rank"]): Card {
  return { suit, rank };
}

function view(overrides: Partial<BotView> = {}): BotView {
  const hand = overrides.hand ?? [card("S", "A"), card("H", "8"), card("C", "5"), card("D", "2")];
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
    phase: "trick",
    bids: { bot: 1, p2: 1, p3: 1 },
    tricksWon: { bot: 0, p2: 0, p3: 0 },
    currentTrick: [],
    playedCards: [],
    historyComplete: true,
    voidSuits: { bot: [], p2: [], p3: [] },
    handCounts: { bot: hand.length, p2: hand.length, p3: hand.length },
    scores: { bot: 20, p2: 10, p3: 0 },
    ...overrides,
  };
}

describe("fair-information card search", () => {
  it("is deterministic, returns a legal card, and respects its CPU budget", () => {
    const botView = view();
    const options = { maxNodes: 1_200, maxDeals: 8, maxIterations: 80 };
    const first = searchBestCard(botView, botView.legalCards, options);
    const second = searchBestCard(botView, botView.legalCards, options);

    expect(second).toEqual(first);
    expect(first.mode).toBe("ismcts");
    expect(first.nodes).toBeLessThanOrEqual(options.maxNodes);
    expect(first.iterations).toBeLessThanOrEqual(options.maxIterations);
    expect(first.determinizations).toBeGreaterThan(0);
    expect(botView.legalCards.map(cardId)).toContain(cardId(first.card));
    expect(first.evaluations).toHaveLength(botView.legalCards.length);
  });

  it("independently filters a supplied off-suit card", () => {
    const botView = view({
      hand: [card("H", "2"), card("S", "A")],
      // Deliberately malformed caller input: search must still derive follow-suit.
      legalCards: [card("H", "2"), card("S", "A")],
      seatOrder: ["p2", "bot"],
      turnSeat: 1,
      bids: { bot: 0, p2: 1 },
      tricksWon: { bot: 0, p2: 0 },
      currentTrick: [{ deviceId: "p2", card: card("H", "A") }],
      handCounts: { bot: 2, p2: 1 },
      voidSuits: { bot: [], p2: [] },
      scores: { bot: 0, p2: 0 },
    });

    const result = searchBestCard(botView, botView.legalCards);
    expect(result.mode).toBe("trivial");
    expect(cardId(result.card)).toBe("H2");
  });

  it("can completely enumerate a fully constrained small endgame", () => {
    const ownHand = [card("S", "A"), card("D", "2")];
    const opponentHand = [card("S", "K"), card("D", "3")];
    const hidden = new Set([...ownHand, ...opponentHand].map(cardId));
    const playedCards: PlayedCardEvent[] = createDeck()
      .filter((candidate) => !hidden.has(cardId(candidate)))
      .map((candidate, index) => ({
        handNumber: Math.floor(index / 2) + 1,
        deviceId: "p2",
        card: candidate,
        leadSuit: candidate.suit,
      }));
    const botView = view({
      hand: ownHand,
      legalCards: ownHand,
      cardsThisRound: 2,
      seatOrder: ["bot", "p2"],
      dealerDeviceId: "p2",
      bids: { bot: 1, p2: null },
      tricksWon: { bot: 0, p2: 0 },
      playedCards,
      handCounts: { bot: 2, p2: 2 },
      voidSuits: { bot: [], p2: [] },
      scores: { bot: 0, p2: 0 },
    });

    const result = searchBestCard(botView, ownHand, {
      maxNodes: 2_000,
      maxEndgameDeals: 8,
    });

    expect(result.mode).toBe("exact-endgame");
    expect(result.complete).toBe(true);
    expect(result.determinizations).toBe(1);
    expect(result.nodes).toBeLessThanOrEqual(2_000);
    expect(ownHand.map(cardId)).toContain(cardId(result.card));
  });

  it("rejects calls made outside the bot's actual turn", () => {
    expect(() => searchBestCard(view({ turnSeat: 1 }))).toThrow(/bot's turn/);
    expect(() => searchBestCard(view({ phase: "bidding" }))).toThrow(/trick-playing phase/);
  });
});

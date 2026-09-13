import { describe, expect, it } from "vitest";
import { sortCards, type Card } from "./cards.js";

describe("sortCards", () => {
  it("groups suits S, H, C, D and ranks each suit from ace to two", () => {
    const cards: Card[] = [
      { suit: "D", rank: "2" },
      { suit: "S", rank: "3" },
      { suit: "H", rank: "K" },
      { suit: "C", rank: "7" },
      { suit: "S", rank: "A" },
      { suit: "D", rank: "Q" },
      { suit: "H", rank: "2" },
      { suit: "C", rank: "A" },
    ];
    expect(sortCards(cards)).toEqual([
      { suit: "S", rank: "A" },
      { suit: "S", rank: "3" },
      { suit: "H", rank: "K" },
      { suit: "H", rank: "2" },
      { suit: "C", rank: "A" },
      { suit: "C", rank: "7" },
      { suit: "D", rank: "Q" },
      { suit: "D", rank: "2" },
    ]);
    expect(cards[0]).toEqual({ suit: "D", rank: "2" });
  });
});

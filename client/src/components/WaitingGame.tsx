import { useEffect, useState } from "react";

interface CardDef {
  id: number;
  suit: string;
  color: string;
}

const SUITS = [
  { suit: "♠", color: "#23231f" },
  { suit: "♥", color: "var(--brick)" },
  { suit: "♦", color: "var(--brick)" },
  { suit: "♣", color: "#23231f" },
];

function shuffledDeck(): CardDef[] {
  const deck = SUITS.flatMap((s, i) => [
    { id: i * 2, suit: s.suit, color: s.color },
    { id: i * 2 + 1, suit: s.suit, color: s.color },
  ]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const MESSAGES = [
  "Waking up the table…",
  "Shuffling the deck…",
  "Setting out the chairs…",
  "Free hosting takes a nap when nobody's around — hang tight.",
];

interface WaitingGameProps {
  attempt: number;
}

export function WaitingGame({ attempt }: WaitingGameProps) {
  const [deck, setDeck] = useState(shuffledDeck);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  const [wins, setWins] = useState(0);

  useEffect(() => {
    if (flipped.length !== 2) return;
    const [a, b] = flipped;
    const cardA = deck.find((c) => c.id === a);
    const cardB = deck.find((c) => c.id === b);
    const isMatch = cardA && cardB && cardA.suit === cardB.suit;
    const timer = setTimeout(
      () => {
        if (isMatch) setMatched((prev) => new Set(prev).add(a).add(b));
        setFlipped([]);
      },
      isMatch ? 250 : 700,
    );
    return () => clearTimeout(timer);
  }, [flipped, deck]);

  useEffect(() => {
    if (matched.size === 0 || matched.size < deck.length) return;
    const timer = setTimeout(() => {
      setDeck(shuffledDeck());
      setMatched(new Set());
      setMoves(0);
      setWins((w) => w + 1);
    }, 900);
    return () => clearTimeout(timer);
  }, [matched, deck.length]);

  function handleFlip(id: number) {
    if (flipped.length === 2 || flipped.includes(id) || matched.has(id)) return;
    setMoves((m) => m + 1);
    setFlipped((prev) => [...prev, id]);
  }

  const message = MESSAGES[Math.min(attempt, MESSAGES.length - 1)];

  return (
    <section className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
      <p className="mb-1 text-xs font-semibold uppercase" style={{ color: "var(--gold)", letterSpacing: "0.16em" }}>
        Donkey Kaun
      </p>
      <h2 className="mb-2 text-xl font-bold">{message}</h2>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-faint)" }}>
        First visit in a while can take up to a minute.{" "}
        {wins > 0 ? `You've cleared the board ${wins}x while you wait!` : "Try a quick memory match while you wait."}
      </p>
      <div className="grid grid-cols-4 gap-2">
        {deck.map((card) => {
          const isFlipped = flipped.includes(card.id) || matched.has(card.id);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => handleFlip(card.id)}
              aria-label={isFlipped ? `${card.suit} card, flipped` : "Face-down card"}
              className="flex h-14 w-11 items-center justify-center rounded-md text-xl font-bold transition-transform duration-150 sm:h-16 sm:w-12"
              style={{
                background: isFlipped ? "var(--card-stock)" : "linear-gradient(160deg, var(--gold-bright), var(--gold))",
                color: isFlipped ? card.color : "rgba(26, 18, 6, 0.45)",
                border: "1px solid var(--hairline)",
                boxShadow: "0 8px 16px -8px rgba(0,0,0,0.4)",
              }}
            >
              {isFlipped ? card.suit : "?"}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-xs" style={{ color: "var(--ink-faint)" }}>
        {moves} moves
      </p>
    </section>
  );
}

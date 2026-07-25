const CARDS = [
  { rank: "A", suit: "♠", kind: "spade", className: "c1" },
  { rank: "K", suit: "♥", kind: "heart", className: "c2" },
  { rank: "Q", suit: "♣", kind: "club", className: "c3" },
  { rank: "J", suit: "♦", kind: "diamond", className: "c4" },
  { rank: "10", suit: "♠", kind: "spade", className: "c5" },
];

export function PlayingCardFan() {
  return (
    <div className="fan" aria-hidden="true">
      {CARDS.map((card, i) => (
        <div key={i} className={`playing-card ${card.kind} ${card.className}`}>
          <span className="corner">{card.rank}</span>
          <span className="center">{card.suit}</span>
          <span className="corner" style={{ alignSelf: "flex-end" }}>
            {card.rank}
          </span>
        </div>
      ))}
    </div>
  );
}

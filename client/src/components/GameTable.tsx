import { Button } from "./Button";
import { SUIT_COLOR, SUIT_SYMBOL, cardKey, cardLabel } from "../lib/cardDisplay";
import type { Card, PublicGameState, PublicPlayer } from "../rooms/types";

interface GameTableProps {
  game: PublicGameState;
  players: PublicPlayer[];
  hand: Card[];
  legalCards: Card[];
  myDeviceId: string;
  isHost: boolean;
  onBid: (bid: number) => void;
  onPlay: (card: Card) => void;
  onNewGame: () => void;
  onContinue: () => void;
  onExit: () => void;
}

export function GameTable({
  game,
  players,
  hand,
  legalCards,
  myDeviceId,
  isHost,
  onBid,
  onPlay,
  onNewGame,
  onContinue,
  onExit,
}: GameTableProps) {
  const nameFor = (id: string) => players.find((p) => p.deviceId === id)?.name ?? "?";
  const legalKeys = new Set(legalCards.map(cardKey));

  const isMyBidTurn = game.phase === "bidding" && game.bidTurnDeviceId === myDeviceId;
  const isMyPlayTurn = game.phase === "trick" && game.turnDeviceId === myDeviceId;

  const maxBid = game.cardsThisRound + 1;
  let forbiddenBid: number | null = null;
  if (isMyBidTurn && game.seatOrder[game.dealerSeat] === myDeviceId) {
    const othersSum = Object.values(game.bids).reduce((sum: number, b) => sum + (typeof b === "number" ? b : 0), 0);
    forbiddenBid = game.cardsThisRound - othersSum;
  }

  return (
    <section className="mx-auto max-w-2xl px-6 pb-16 text-center">
      <div className="mb-6 flex items-center justify-center gap-6 text-sm" style={{ color: "var(--ink-dim)" }}>
        <span>Round {game.round} / 8</span>
        <span>
          Trump{" "}
          <strong style={{ color: SUIT_COLOR[game.trumpSuit], fontSize: "1.1em" }}>
            {SUIT_SYMBOL[game.trumpSuit]}
          </strong>
        </span>
        <span>Dealer {nameFor(game.seatOrder[game.dealerSeat])}</span>
      </div>

      {game.lastRoundSummary && (
        <div
          className="mb-6 rounded-xl border p-3 text-left text-xs"
          style={{ borderColor: "var(--hairline)", background: "var(--ground-raised)" }}
        >
          <p className="mb-1 font-semibold" style={{ color: "var(--gold)" }}>
            Round {game.lastRoundSummary.round} result
          </p>
          {game.lastRoundSummary.results.map((r) => (
            <span key={r.deviceId} className="mr-3" style={{ color: "var(--ink-dim)" }}>
              {nameFor(r.deviceId)}: bid {r.bid}, won {r.tricksWon} ({r.roundScore} pts)
            </span>
          ))}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {game.seatOrder.map((id) => (
          <div
            key={id}
            className="rounded-lg border px-3 py-2"
            style={{
              borderColor:
                id === game.turnDeviceId || id === game.bidTurnDeviceId ? "var(--gold-bright)" : "var(--hairline)",
              background: "var(--ground-raised)",
            }}
          >
            <p className="font-semibold" style={{ color: id === myDeviceId ? "var(--gold-bright)" : "var(--ink)" }}>
              {nameFor(id)}
              {id === myDeviceId ? " (you)" : ""}
              {id === game.seatOrder[game.dealerSeat] ? " · dealer" : ""}
            </p>
            <p style={{ color: "var(--ink-faint)" }}>
              bid {game.bids[id] ?? "—"} · won {game.tricksWon[id] ?? 0} · score {game.scores[id] ?? 0}
            </p>
          </div>
        ))}
      </div>

      {game.phase === "bidding" && (
        <div className="mb-8">
          {isMyBidTurn ? (
            <>
              <p className="mb-3 text-sm" style={{ color: "var(--ink-dim)" }}>
                Your bid — how many tricks will you win?
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {Array.from({ length: maxBid + 1 }, (_, n) => n).map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={n === forbiddenBid}
                    onClick={() => onBid(n)}
                    title={n === forbiddenBid ? "Not allowed — would make total bids match the cards dealt" : undefined}
                    className="h-10 w-10 rounded-full text-sm font-semibold disabled:opacity-30"
                    style={{
                      background:
                        n === forbiddenBid ? "transparent" : "linear-gradient(180deg, var(--gold-bright), var(--gold))",
                      color: n === forbiddenBid ? "var(--ink-faint)" : "#1a1206",
                      border: "1px solid var(--hairline)",
                    }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: "var(--ink-dim)" }}>Waiting for {nameFor(game.bidTurnDeviceId ?? "")} to bid…</p>
          )}
        </div>
      )}

      {game.phase === "trick" && (
        <div className="mb-8">
          <div className="mb-4 flex min-h-[64px] flex-wrap items-center justify-center gap-3">
            {game.currentTrick.length === 0 && <p style={{ color: "var(--ink-faint)" }}>Trick starting…</p>}
            {game.currentTrick.map((t) => (
              <div key={t.deviceId} className="text-center">
                <div
                  className="mb-1 flex h-16 w-12 items-center justify-center rounded-md text-lg font-bold"
                  style={{ background: "var(--card-stock)", color: SUIT_COLOR[t.card.suit], border: "1px solid var(--hairline)" }}
                >
                  {cardLabel(t.card)}
                </div>
                <span className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
                  {nameFor(t.deviceId)}
                </span>
              </div>
            ))}
          </div>
          <p className="mb-4 text-sm" style={{ color: "var(--ink-dim)" }}>
            {isMyPlayTurn ? "Your turn — play a card" : `Waiting for ${nameFor(game.turnDeviceId ?? "")}…`}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {hand.map((card) => {
              const legal = !isMyPlayTurn || legalKeys.has(cardKey(card));
              return (
                <button
                  key={cardKey(card)}
                  type="button"
                  disabled={!isMyPlayTurn || !legal}
                  onClick={() => onPlay(card)}
                  className="flex h-20 w-14 items-center justify-center rounded-md text-lg font-bold transition-transform duration-150 disabled:opacity-35"
                  style={{
                    background: "var(--card-stock)",
                    color: SUIT_COLOR[card.suit],
                    border: "1px solid var(--hairline)",
                    transform: isMyPlayTurn && legal ? "translateY(-4px)" : undefined,
                  }}
                >
                  {cardLabel(card)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {game.phase === "game-end" && (
        <div className="mb-8">
          <h3 className="mb-3 text-xl font-bold">Game over</h3>
          <p className="mb-4 text-sm" style={{ color: "var(--ink-dim)" }}>
            {game.donkeys?.map(nameFor).join(", ")} {game.donkeys && game.donkeys.length > 1 ? "are" : "is"} the Donkey
            🫏
          </p>
          {isHost ? (
            <div className="flex flex-wrap justify-center gap-3">
              <Button variant="primary" onClick={onNewGame}>
                New Game
              </Button>
              <Button variant="ghost" onClick={onContinue}>
                Continue (keep scores)
              </Button>
              <Button variant="ghost" onClick={onExit}>
                Exit
              </Button>
            </div>
          ) : (
            <p style={{ color: "var(--ink-dim)" }}>Waiting for the host to choose new game, continue, or exit…</p>
          )}
        </div>
      )}
    </section>
  );
}

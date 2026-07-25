import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AvatarThumb } from "./AvatarThumb";
import { Button } from "./Button";
import { ScoreSheetModal } from "./ScoreSheetModal";
import { gameSeatPosition, pileSlotPosition } from "../rooms/gameSeatLayout";
import { useDealAnimation, useTrickAnimation } from "../rooms/gameAnimations";
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
  const [showScoreSheet, setShowScoreSheet] = useState(false);
  const nameFor = (id: string) => players.find((p) => p.deviceId === id)?.name ?? "?";
  const legalKeys = new Set(legalCards.map(cardKey));

  const total = game.seatOrder.length;
  const mySeatIndex = game.seatOrder.indexOf(myDeviceId);

  const { dealing, dealEvents } = useDealAnimation(game);
  const { displayTrick, sweepWinnerSeat, sweeping } = useTrickAnimation(game);

  const isMyBidTurn = game.phase === "bidding" && game.bidTurnDeviceId === myDeviceId;
  const isMyPlayTurn = game.phase === "trick" && game.turnDeviceId === myDeviceId;

  const maxBid = game.cardsThisRound + 1;
  let forbiddenBid: number | null = null;
  if (isMyBidTurn && game.seatOrder[game.dealerSeat] === myDeviceId) {
    const othersSum = Object.values(game.bids).reduce((sum: number, b) => sum + (typeof b === "number" ? b : 0), 0);
    forbiddenBid = game.cardsThisRound - othersSum;
  }

  return (
    <section className="mx-auto max-w-2xl px-4 pb-16 text-center">
      {game.lastRoundSummary && (
        <p className="mb-3 text-xs" style={{ color: "var(--ink-faint)" }}>
          Round {game.lastRoundSummary.round} result:{" "}
          {game.lastRoundSummary.results
            .map((r) => `${nameFor(r.deviceId)} ${r.bid}→${r.tricksWon} (${r.roundScore})`)
            .join(" · ")}
        </p>
      )}

      <div className="relative mx-auto mb-6 h-[380px] max-w-xl">
        <div
          className="absolute inset-[14%] rounded-full border"
          style={{
            borderColor: "var(--hairline)",
            background: "radial-gradient(ellipse at center, var(--ground-raised-2), var(--ground-raised) 75%)",
          }}
        />

        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <div className="text-xs" style={{ color: "var(--ink-dim)" }}>
            Round {game.round}/8 · Trump{" "}
            <strong style={{ color: SUIT_COLOR[game.trumpSuit], fontSize: "1.1em" }}>
              {SUIT_SYMBOL[game.trumpSuit]}
            </strong>
          </div>
          {game.phase === "trick" && !dealing && displayTrick.length === 0 && (
            <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
              Hand starting…
            </p>
          )}
        </div>

        <AnimatePresence>
          {displayTrick.map((t) => {
            const seatIdx = game.seatOrder.indexOf(t.deviceId);
            const seatPos = gameSeatPosition(seatIdx, mySeatIndex, total);
            const pilePos = pileSlotPosition(seatIdx, mySeatIndex, total);
            const isSweepTarget = sweeping && sweepWinnerSeat !== null;
            const targetPos = isSweepTarget ? gameSeatPosition(sweepWinnerSeat, mySeatIndex, total) : pilePos;
            return (
              <motion.div
                key={`${t.deviceId}-${cardKey(t.card)}`}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ zIndex: 5 }}
                initial={{ top: seatPos.top, left: seatPos.left, opacity: 0, scale: 0.7 }}
                animate={{
                  top: targetPos.top,
                  left: targetPos.left,
                  opacity: isSweepTarget ? 0 : 1,
                  scale: isSweepTarget ? 0.4 : 1,
                }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ duration: isSweepTarget ? 0.5 : 0.35, ease: "easeOut" }}
              >
                <div
                  className="flex h-14 w-10 items-center justify-center rounded-md text-base font-bold"
                  style={{ background: "var(--card-stock)", color: SUIT_COLOR[t.card.suit], border: "1px solid var(--hairline)" }}
                >
                  {cardLabel(t.card)}
                </div>
                <span className="mt-1 text-[9px]" style={{ color: "var(--ink-faint)" }}>
                  {nameFor(t.deviceId)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {dealing && (
          <div className="pointer-events-none absolute inset-0">
            {dealEvents.map((ev, i) => {
              const pos = gameSeatPosition(ev.seatIndex, mySeatIndex, total);
              return (
                <motion.div
                  key={i}
                  className="absolute h-9 w-6 -translate-x-1/2 -translate-y-1/2 rounded-sm"
                  style={{
                    background: "linear-gradient(160deg, var(--gold-bright), var(--gold))",
                    border: "1px solid var(--hairline)",
                    zIndex: 4,
                  }}
                  initial={{ top: "50%", left: "50%", opacity: 0, scale: 0.5 }}
                  animate={{ top: pos.top, left: pos.left, opacity: 1, scale: 1 }}
                  transition={{ delay: ev.delay / 1000, duration: 0.35, ease: "easeOut" }}
                />
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowScoreSheet(true)}
          className="absolute right-0 top-0 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ border: "1px solid var(--hairline)", color: "var(--ink-dim)", background: "var(--ground-raised)" }}
        >
          Scoresheet
        </button>

        {game.seatOrder.map((id, seatIndex) => {
          const position = gameSeatPosition(seatIndex, mySeatIndex, total);
          const player = players.find((p) => p.deviceId === id);
          const isSelf = id === myDeviceId;
          const isTurn = !dealing && (id === game.turnDeviceId || id === game.bidTurnDeviceId);
          return (
            <div
              key={id}
              className="absolute flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center"
              style={{ top: position.top, left: position.left }}
            >
              <div className="relative mb-1">
                {player && (
                  <AvatarThumb
                    avatar={player.avatar}
                    size={44}
                    className={player.connected ? "" : "opacity-40 grayscale"}
                  />
                )}
                {isTurn && (
                  <span
                    className="absolute inset-0 rounded-full"
                    style={{ boxShadow: "0 0 0 3px var(--gold-bright)" }}
                  />
                )}
                {id === game.seatOrder[game.dealerSeat] && (
                  <span
                    className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
                    style={{ background: "var(--gold-bright)", color: "#1a1206" }}
                    title="Dealer"
                  >
                    D
                  </span>
                )}
              </div>
              <span
                className="max-w-[4.5rem] truncate text-xs font-semibold"
                style={{ color: isSelf ? "var(--gold-bright)" : "var(--ink)" }}
              >
                {nameFor(id)}
                {isSelf ? " (you)" : ""}
              </span>
              <span className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
                score {game.scores[id] ?? 0}
              </span>
              <span className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
                bid {game.bids[id] ?? "—"} · won {game.tricksWon[id] ?? 0}
              </span>
              {!isSelf && (game.handCounts[id] ?? 0) > 0 && (
                <span className="text-[9px]" style={{ color: "var(--ink-faint)" }}>
                  🂠 ×{game.handCounts[id]}
                </span>
              )}
              {player && !player.connected && (
                <span className="text-[9px]" style={{ color: "var(--ink-faint)" }}>
                  reconnecting…
                </span>
              )}
            </div>
          );
        })}
      </div>

      {!dealing && game.phase === "bidding" && (
        <p className="mb-3 text-sm" style={{ color: "var(--ink-dim)" }}>
          {isMyBidTurn ? "Your bid — how many hands will you win?" : `Waiting for ${nameFor(game.bidTurnDeviceId ?? "")} to bid…`}
        </p>
      )}
      {!dealing && game.phase === "trick" && (
        <p className="mb-3 text-sm" style={{ color: "var(--ink-dim)" }}>
          {sweeping && sweepWinnerSeat !== null
            ? `${nameFor(game.seatOrder[sweepWinnerSeat])} wins the hand!`
            : displayTrick.length === total
              ? "Hand complete…"
              : isMyPlayTurn
                ? "Your turn — play a card"
                : `Waiting for ${nameFor(game.turnDeviceId ?? "")}…`}
        </p>
      )}

      {!dealing && game.phase === "bidding" && isMyBidTurn && (
        <div className="mb-6 flex flex-wrap justify-center gap-2">
          {Array.from({ length: maxBid + 1 }, (_, n) => n).map((n) => (
            <button
              key={n}
              type="button"
              disabled={n === forbiddenBid}
              onClick={() => onBid(n)}
              title={n === forbiddenBid ? "Not allowed — would make total bids match the cards dealt" : undefined}
              className="h-10 w-10 rounded-full text-sm font-semibold disabled:opacity-30"
              style={{
                background: n === forbiddenBid ? "transparent" : "linear-gradient(180deg, var(--gold-bright), var(--gold))",
                color: n === forbiddenBid ? "var(--ink-faint)" : "#1a1206",
                border: "1px solid var(--hairline)",
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {!dealing && (game.phase === "bidding" || game.phase === "trick") && hand.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-xs" style={{ color: "var(--ink-faint)" }}>
            Your hand
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {hand.map((card) => {
              const legal = !isMyPlayTurn || legalKeys.has(cardKey(card));
              const clickable = isMyPlayTurn && legal;
              return (
                <button
                  key={cardKey(card)}
                  type="button"
                  disabled={!clickable}
                  onClick={() => onPlay(card)}
                  className="flex h-20 w-14 items-center justify-center rounded-md text-lg font-bold transition-transform duration-150 disabled:opacity-35"
                  style={{
                    background: "var(--card-stock)",
                    color: SUIT_COLOR[card.suit],
                    border: "1px solid var(--hairline)",
                    transform: clickable ? "translateY(-4px)" : undefined,
                    cursor: game.phase === "bidding" ? "default" : undefined,
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

      {showScoreSheet && (
        <ScoreSheetModal
          roundHistory={game.roundHistory}
          players={players}
          scores={game.scores}
          seatOrder={game.seatOrder}
          onClose={() => setShowScoreSheet(false)}
        />
      )}
    </section>
  );
}

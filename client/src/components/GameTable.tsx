import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AvatarThumb } from "./AvatarThumb";
import { Button } from "./Button";
import { ScoreSheetModal } from "./ScoreSheetModal";
import { gameSeatPosition, pileSlotPosition } from "../rooms/gameSeatLayout";
import { useDealAnimation, useRoundRecap, useTrickAnimation } from "../rooms/gameAnimations";
import { SUIT_COLOR, SUIT_SYMBOL, cardKey, cardLabel } from "../lib/cardDisplay";
import {
  playCardSound,
  playGameEndSound,
  playRoundEndSound,
  playTrickWinSound,
  playYourTurnSound,
} from "../sound/soundEngine";
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
  speakingDeviceIds?: Set<string>;
  mutedVoiceDeviceIds?: Set<string>;
  onToggleVoiceMute?: (deviceId: string) => void;
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
  speakingDeviceIds,
  mutedVoiceDeviceIds,
  onToggleVoiceMute,
}: GameTableProps) {
  const [showScoreSheet, setShowScoreSheet] = useState(false);
  const nameFor = (id: string) => players.find((p) => p.deviceId === id)?.name ?? "?";
  const legalKeys = new Set(legalCards.map(cardKey));

  const total = game.seatOrder.length;
  const mySeatIndex = game.seatOrder.indexOf(myDeviceId);

  const { dealing, dealEvents } = useDealAnimation(game);
  const { displayTrick, sweepWinnerSeat, sweeping } = useTrickAnimation(game);
  const { visible: recapVisible, summary: roundSummary } = useRoundRecap(game);

  const confettiParticles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        angle: (360 / 14) * i + (i % 2 === 0 ? 8 : -8),
        distance: 60 + (i % 3) * 20,
        symbol: ["♠", "♥", "♦", "♣"][i % 4],
        delay: (i % 5) * 0.05,
      })),
    [],
  );

  const isMyBidTurn = game.phase === "bidding" && game.bidTurnDeviceId === myDeviceId;
  const isMyPlayTurn = game.phase === "trick" && game.turnDeviceId === myDeviceId;

  const prevTrickLenRef = useRef(displayTrick.length);
  useEffect(() => {
    if (displayTrick.length > prevTrickLenRef.current) {
      playCardSound();
    }
    prevTrickLenRef.current = displayTrick.length;
  }, [displayTrick.length]);

  const prevSweepingRef = useRef(sweeping);
  useEffect(() => {
    if (sweeping && !prevSweepingRef.current) {
      playTrickWinSound();
    }
    prevSweepingRef.current = sweeping;
  }, [sweeping]);

  const isMyTurn = isMyBidTurn || isMyPlayTurn;
  const prevMyTurnRef = useRef(isMyTurn);
  useEffect(() => {
    if (isMyTurn && !prevMyTurnRef.current) {
      playYourTurnSound();
    }
    prevMyTurnRef.current = isMyTurn;
  }, [isMyTurn]);

  const prevRoundSummaryRef = useRef(roundSummary);
  useEffect(() => {
    if (roundSummary && roundSummary !== prevRoundSummaryRef.current && game.phase !== "game-end") {
      playRoundEndSound();
    }
    prevRoundSummaryRef.current = roundSummary;
  }, [roundSummary, game.phase]);

  const prevPhaseRef = useRef(game.phase);
  useEffect(() => {
    if (game.phase === "game-end" && prevPhaseRef.current !== "game-end") {
      playGameEndSound();
    }
    prevPhaseRef.current = game.phase;
  }, [game.phase]);

  const maxBid = game.cardsThisRound + 1;
  let forbiddenBid: number | null = null;
  if (isMyBidTurn && game.seatOrder[game.dealerSeat] === myDeviceId) {
    const othersSum = Object.values(game.bids).reduce((sum: number, b) => sum + (typeof b === "number" ? b : 0), 0);
    forbiddenBid = game.cardsThisRound - othersSum;
  }

  return (
    <section className="mx-auto max-w-2xl px-4 pb-16 text-center">
      <button
        type="button"
        onClick={() => setShowScoreSheet(true)}
        className="fixed left-4 top-4 z-40 rounded-full px-3 py-1.5 text-xs font-semibold"
        style={{ border: "1px solid var(--hairline)", color: "var(--ink-dim)", background: "var(--ground-raised)" }}
      >
        Scoresheet
      </button>

      {roundSummary && (
        <AnimatePresence mode="wait">
          {recapVisible ? (
            <motion.div
              key="recap-rich"
              className="mx-auto mb-4 max-w-md rounded-2xl border px-5 py-3 text-left"
              style={{ background: "var(--ground-raised)", borderColor: "var(--hairline)" }}
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
            >
              <p className="mb-2 text-xs font-semibold uppercase" style={{ color: "var(--gold)", letterSpacing: "0.14em" }}>
                Round {roundSummary.round} complete
              </p>
              <div className="flex flex-col gap-1">
                {roundSummary.results.map((r) => {
                  const made = r.bid === r.tricksWon;
                  return (
                    <div key={r.deviceId} className="flex items-center justify-between gap-6 text-sm">
                      <span style={{ color: "var(--ink)" }}>{nameFor(r.deviceId)}</span>
                      <span style={{ color: made ? "var(--gold-bright)" : "var(--brick)" }}>
                        bid {r.bid} → won {r.tricksWon} · {r.roundScore} pts
                      </span>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <motion.p
              key="recap-compact"
              className="mb-3 text-xs"
              style={{ color: "var(--ink-faint)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              Round {roundSummary.round} result:{" "}
              {roundSummary.results.map((r) => `${nameFor(r.deviceId)} ${r.bid}→${r.tricksWon} (${r.roundScore})`).join(" · ")}
            </motion.p>
          )}
        </AnimatePresence>
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
              <motion.div
                className="relative mb-1"
                animate={player && !player.connected ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
                transition={player && !player.connected ? { repeat: Infinity, duration: 1.6, ease: "easeInOut" } : undefined}
              >
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
                {speakingDeviceIds?.has(id) && (
                  <span
                    className="absolute inset-0 animate-pulse rounded-full"
                    style={{ boxShadow: "0 0 0 3px rgba(237, 231, 214, 0.75)" }}
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
                {!isSelf && onToggleVoiceMute && (
                  <button
                    type="button"
                    onClick={() => onToggleVoiceMute(id)}
                    aria-label={`${mutedVoiceDeviceIds?.has(id) ? "Unmute" : "Mute"} ${nameFor(id)}`}
                    aria-pressed={mutedVoiceDeviceIds?.has(id) ?? false}
                    title={`${mutedVoiceDeviceIds?.has(id) ? "Unmute" : "Mute"} ${nameFor(id)} on this device`}
                    className="absolute -left-1 -bottom-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px]"
                    style={{
                      border: "1px solid var(--hairline)",
                      background: mutedVoiceDeviceIds?.has(id) ? "var(--brick)" : "var(--ground-raised-2)",
                      color: "var(--ink)",
                    }}
                  >
                    {mutedVoiceDeviceIds?.has(id) ? "🔇" : "🔊"}
                  </button>
                )}
              </motion.div>
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
        <div className="relative mb-8">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-visible">
            {confettiParticles.map((p, i) => {
              const rad = (p.angle * Math.PI) / 180;
              const x = Math.cos(rad) * p.distance;
              const y = Math.sin(rad) * p.distance;
              return (
                <motion.span
                  key={i}
                  className="absolute text-lg"
                  style={{ color: i % 2 === 0 ? "var(--gold-bright)" : "var(--brick)" }}
                  initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }}
                  animate={{ x, y, opacity: 0, scale: 1 }}
                  transition={{ duration: 1.1, delay: p.delay, ease: "easeOut" }}
                >
                  {p.symbol}
                </motion.span>
              );
            })}
          </div>
          <motion.h3
            className="mb-3 text-xl font-bold"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
          >
            Game over
          </motion.h3>
          <motion.p
            className="mb-4 text-sm"
            style={{ color: "var(--ink-dim)" }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            {game.donkeys?.map(nameFor).join(", ")} {game.donkeys && game.donkeys.length > 1 ? "are" : "is"} the Donkey
            🫏
          </motion.p>
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

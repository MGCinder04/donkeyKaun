import { useEffect, useRef, type KeyboardEvent } from "react";
import { Button } from "./Button";
import { AvatarThumb } from "./AvatarThumb";
import type { PublicPlayer } from "../rooms/types";
import { BOT_KINDS, BOT_PROFILES, type BotKind } from "../bots/catalog";

interface PlayerAdminModalProps {
  player: PublicPlayer;
  replacementOpen: boolean;
  canRemove: boolean;
  onKick: () => Promise<void>;
  onToggleReplacement: () => Promise<void>;
  onRemove: () => Promise<void>;
  onBotTakeover: (kind: BotKind) => Promise<void>;
  onClose: () => void;
}

export function PlayerAdminModal({
  player,
  replacementOpen,
  canRemove,
  onKick,
  onToggleReplacement,
  onRemove,
  onBotTakeover,
  onClose,
}: PlayerAdminModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto p-4"
      style={{ background: "rgba(0,0,0,0.62)" }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-admin-title"
        className="my-auto w-full max-w-md rounded-3xl border p-6 text-left shadow-2xl"
        style={{ background: "var(--ground-raised)", borderColor: "var(--hairline)" }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="mb-5 flex items-center gap-3">
          <AvatarThumb avatar={player.avatar} size={52} />
          <div>
            <h3 id="player-admin-title" className="text-xl font-bold">Manage {player.name}</h3>
            <p className="text-sm" style={{ color: "var(--ink-dim)" }}>
              {player.botKind ? `${BOT_PROFILES[player.botKind].level} bot` : player.connected ? "Currently connected" : "Waiting to reconnect"}
            </p>
          </div>
        </div>

        {player.botKind ? (
          <div className="space-y-3">
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
              <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                {BOT_PROFILES[player.botKind].description} This seat is controlled entirely by the server and never sees another player’s cards.
              </p>
              <Button
                variant="ghost"
                className="w-full text-base"
                disabled={!canRemove}
                onClick={onRemove}
                style={{ color: "var(--brick)" }}
              >
                Remove bot and continue
              </Button>
              {!canRemove && <p className="mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>At least two players must remain.</p>}
            </div>
          </div>
        ) : player.connected ? (
          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
            <p className="mb-4 text-sm leading-relaxed" style={{ color: "var(--ink-dim)" }}>
              Disconnecting keeps this seat, cards, bid, hands won, and score reserved until you decide what happens next.
            </p>
            <Button variant="ghost" className="w-full text-base" onClick={onKick}>
              Remove player from room
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
              <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                Keep the seat reserved if {player.name} is coming back. Their usual room link will restore everything automatically.
              </p>
              <Button variant="ghost" className="w-full text-base" onClick={onClose}>
                Keep seat reserved
              </Button>
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
              <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                Hand this exact seat, cards, bid, hands won, and score to a bot right now.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {BOT_KINDS.map((kind) => (
                  <Button key={kind} variant="ghost" className="text-sm" onClick={() => onBotTakeover(kind)}>
                    {BOT_PROFILES[kind].emoji} {BOT_PROFILES[kind].name}
                  </Button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
              <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                Let the next new person who opens this room inherit this exact seat and continue from here.
              </p>
              <Button variant="primary" className="w-full text-base" onClick={onToggleReplacement}>
                {replacementOpen ? "Close replacement seat" : "Open for a replacement"}
              </Button>
            </div>

            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--hairline)" }}>
              <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--ink-dim)" }}>
                Permanently discard this player’s remaining cards and continue with one fewer seat.
              </p>
              <Button
                variant="ghost"
                className="w-full text-base"
                disabled={!canRemove}
                onClick={onRemove}
                style={{ color: "var(--brick)" }}
              >
                Remove seat and continue
              </Button>
              {!canRemove && (
                <p className="mt-2 text-xs" style={{ color: "var(--ink-faint)" }}>
                  At least two players must remain.
                </p>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full py-2 text-sm font-semibold"
          style={{ color: "var(--ink-dim)" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

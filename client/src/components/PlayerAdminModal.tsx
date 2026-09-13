import { Button } from "./Button";
import { AvatarThumb } from "./AvatarThumb";
import type { PublicPlayer } from "../rooms/types";

interface PlayerAdminModalProps {
  player: PublicPlayer;
  replacementOpen: boolean;
  canRemove: boolean;
  onKick: () => Promise<void>;
  onToggleReplacement: () => Promise<void>;
  onRemove: () => Promise<void>;
  onClose: () => void;
}

export function PlayerAdminModal({
  player,
  replacementOpen,
  canRemove,
  onKick,
  onToggleReplacement,
  onRemove,
  onClose,
}: PlayerAdminModalProps) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.62)" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-admin-title"
        className="w-full max-w-md rounded-3xl border p-6 text-left shadow-2xl"
        style={{ background: "var(--ground-raised)", borderColor: "var(--hairline)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center gap-3">
          <AvatarThumb avatar={player.avatar} size={52} />
          <div>
            <h3 id="player-admin-title" className="text-xl font-bold">Manage {player.name}</h3>
            <p className="text-sm" style={{ color: "var(--ink-dim)" }}>
              {player.connected ? "Currently connected" : "Waiting to reconnect"}
            </p>
          </div>
        </div>

        {player.connected ? (
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

import { AvatarThumb } from "./AvatarThumb";
import type { PublicPlayer } from "../rooms/types";
import type { SeatPosition } from "../rooms/seatLayout";

interface SeatProps {
  player?: PublicPlayer;
  position: SeatPosition;
  isSelf: boolean;
  onClickSelf?: () => void;
  onKick?: () => void;
}

export function Seat({ player, position, isSelf, onClickSelf, onKick }: SeatProps) {
  const style = { top: position.top, left: position.left, transform: "translate(-50%, -50%)" };

  if (!player) {
    return (
      <div className="absolute flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center" style={style}>
        <div
          className="mb-1 flex h-11 w-11 items-center justify-center rounded-full border border-dashed text-lg"
          style={{ borderColor: "var(--hairline)", color: "var(--ink-faint)" }}
        >
          +
        </div>
        <span className="text-xs" style={{ color: "var(--ink-faint)" }}>
          open
        </span>
      </div>
    );
  }

  const content = (
    <>
      <div className="relative mb-1">
        <AvatarThumb
          avatar={player.avatar}
          size={46}
          className={player.connected ? "" : "opacity-40 grayscale"}
        />
        {player.isHost && (
          <span
            className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
            style={{ background: "var(--gold-bright)", color: "#1a1206" }}
            title="Host"
          >
            ★
          </span>
        )}
        {onKick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onKick();
            }}
            aria-label={`Remove ${player.name} from the room`}
            title="Remove player"
            className="absolute -top-1 -left-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none"
            style={{ background: "var(--brick)", color: "var(--ink)" }}
          >
            ✕
          </button>
        )}
      </div>
      <span
        className="max-w-[4rem] truncate text-xs font-semibold"
        style={{ color: isSelf ? "var(--gold-bright)" : "var(--ink)" }}
      >
        {player.name}
        {isSelf ? " (you)" : ""}
      </span>
      {!player.connected && (
        <span className="text-[10px]" style={{ color: "var(--ink-faint)" }}>
          reconnecting…
        </span>
      )}
    </>
  );

  if (isSelf && onClickSelf) {
    return (
      <button
        type="button"
        onClick={onClickSelf}
        aria-label="Change your name or avatar"
        className="absolute flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center transition-transform hover:-translate-y-[calc(50%+2px)]"
        style={style}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="absolute flex w-16 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center" style={style}>
      {content}
    </div>
  );
}

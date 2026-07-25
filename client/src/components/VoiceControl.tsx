import { Button } from "./Button";
import type { VoiceChatState } from "../voice/useVoiceChat";

interface VoiceControlProps {
  state: VoiceChatState;
}

export function VoiceControl({ state }: VoiceControlProps) {
  const { micEnabled, micPending, micError, muted, enableMic, toggleMute } = state;

  if (!micEnabled) {
    return (
      <div className="mb-10 flex flex-col items-center gap-1">
        <Button variant="ghost" onClick={enableMic} disabled={micPending}>
          {micPending ? "Requesting mic…" : "🎤 Enable voice chat"}
        </Button>
        {micError && (
          <p className="text-xs" style={{ color: "var(--brick)" }}>
            {micError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mb-10 flex justify-center">
      <button
        type="button"
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? "Unmute microphone" : "Mute microphone"}
        className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
        style={{
          border: "1px solid var(--hairline)",
          background: muted ? "var(--brick)" : "var(--ground-raised)",
          color: "var(--ink)",
        }}
      >
        {muted ? "🔇 Muted" : "🎤 Live"}
      </button>
    </div>
  );
}

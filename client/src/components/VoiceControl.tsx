import { Button } from "./Button";
import type { VoiceChatState } from "../voice/useVoiceChat";

interface VoiceControlProps {
  state: VoiceChatState;
}

export function VoiceControl({ state }: VoiceControlProps) {
  const {
    micEnabled,
    micPending,
    micError,
    micMuted,
    listeningMuted,
    playbackBlocked,
    connectedPeerCount,
    peerCount,
    turnAvailable,
    enableMic,
    toggleMicMute,
    toggleListeningMute,
    resumeAudio,
  } = state;

  return (
    <div className="mb-10 flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        {micEnabled ? (
          <button
            type="button"
            onClick={toggleMicMute}
            aria-pressed={micMuted}
            aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
            style={{
              border: "1px solid var(--hairline)",
              background: micMuted ? "var(--brick)" : "var(--ground-raised)",
              color: "var(--ink)",
            }}
          >
            {micMuted ? "🎙️ Mic muted" : "🎙️ Mic live"}
          </button>
        ) : (
          <Button variant="ghost" onClick={enableMic} disabled={micPending}>
            {micPending ? "Requesting mic…" : "🎙️ Turn on microphone"}
          </Button>
        )}

        <button
          type="button"
          onClick={toggleListeningMute}
          aria-pressed={listeningMuted}
          aria-label={listeningMuted ? "Unmute all players" : "Mute all players"}
          className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
          style={{
            border: "1px solid var(--hairline)",
            background: listeningMuted ? "var(--brick)" : "var(--ground-raised)",
            color: "var(--ink)",
          }}
        >
          {listeningMuted ? "🔇 Players muted" : "🔊 Listening"}
        </button>
      </div>

      {playbackBlocked && !listeningMuted && (
        <Button variant="primary" onClick={resumeAudio}>
          Tap to hear players
        </Button>
      )}

      <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
        {peerCount === 0
          ? "Voice is ready — waiting for other players."
          : `${connectedPeerCount} of ${peerCount} voice connections ready${turnAvailable ? " · TURN fallback ready" : ""}`}
      </p>
      {micError && (
        <p className="text-xs" style={{ color: "var(--brick)" }}>
          {micError}
        </p>
      )}
    </div>
  );
}

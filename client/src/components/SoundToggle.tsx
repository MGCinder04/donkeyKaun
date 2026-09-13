import { useSoundPref } from "../sound/useSoundPref";

export function SoundToggle() {
  const { muted, toggleMuted } = useSoundPref();

  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      className="flex h-9 w-9 items-center justify-center rounded-full border text-base transition-transform hover:-translate-y-0.5"
      style={{ borderColor: "var(--hairline)", background: "var(--ground-raised)", color: "var(--ink)" }}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}

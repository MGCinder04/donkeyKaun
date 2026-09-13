import { motion } from "framer-motion";

interface PrivateAssistControlProps {
  unlocked: boolean;
  enabled: boolean;
  busy: boolean;
  onToggle: () => void;
}

export function PrivateAssistControl({ unlocked, enabled, busy, onToggle }: PrivateAssistControlProps) {
  if (!unlocked) return null;

  return (
    <div
      className="mx-auto mb-6 flex max-w-md items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left shadow-lg"
      style={{ background: "var(--ground-raised)", borderColor: "var(--gold)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <motion.span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ background: "var(--ground-raised-2)", color: "var(--gold-bright)" }}
          animate={enabled ? { boxShadow: ["0 0 0 0 rgba(218,165,70,0)", "0 0 0 6px rgba(218,165,70,.18)", "0 0 0 0 rgba(218,165,70,0)"] } : {}}
          transition={enabled ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : undefined}
        >
          🧠
        </motion.span>
        <div className="min-w-0">
          <p className="font-semibold" style={{ color: "var(--ink)" }}>
            {enabled ? "Ustaad is playing" : "Ustaad assist"}
          </p>
          <p className="text-xs" style={{ color: "var(--ink-faint)" }}>
            {enabled ? "Your identity and voice stay unchanged." : "Only you can see this control."}
          </p>
        </div>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={onToggle}
        aria-pressed={enabled}
        className="shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-transform hover:-translate-y-0.5 disabled:opacity-50"
        style={{
          borderColor: enabled ? "var(--brick)" : "var(--gold)",
          background: enabled ? "var(--brick)" : "linear-gradient(180deg, var(--gold-bright), var(--gold))",
          color: enabled ? "var(--ink)" : "#1a1206",
        }}
      >
        {busy ? "Wait…" : enabled ? "Take over" : "Let Ustaad play"}
      </button>
    </div>
  );
}

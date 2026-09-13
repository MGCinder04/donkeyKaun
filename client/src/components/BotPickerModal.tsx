import { useEffect, useRef, type KeyboardEvent } from "react";
import { motion } from "framer-motion";
import { BOT_KINDS, BOT_PROFILES, type BotKind } from "../bots/catalog";

interface BotPickerModalProps {
  title?: string;
  busy?: boolean;
  onChoose: (kind: BotKind) => void;
  onClose: () => void;
}

export function BotPickerModal({ title = "Invite a bot", busy, onChoose, onClose }: BotPickerModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
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
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto p-4"
      style={{ background: "rgba(0,0,0,0.68)" }}
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-picker-title"
        className="my-auto w-full max-w-2xl rounded-3xl border p-5 shadow-2xl sm:p-7"
        style={{ background: "var(--ground-raised)", borderColor: "var(--hairline)" }}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--gold)", letterSpacing: "0.16em" }}>
              Choose your opponent
            </p>
            <h3 id="bot-picker-title" className="text-2xl font-bold sm:text-3xl">{title}</h3>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close bot picker" className="h-12 w-12 rounded-full text-xl" style={{ color: "var(--ink-dim)", border: "1px solid var(--hairline)" }}>×</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {BOT_KINDS.map((kind) => {
            const bot = BOT_PROFILES[kind];
            return (
              <button
                key={kind}
                type="button"
                disabled={busy}
                onClick={() => onChoose(kind)}
                className="group flex min-h-32 items-center gap-4 rounded-2xl border p-4 text-left transition-transform hover:-translate-y-1 disabled:opacity-50"
                style={{ background: "var(--ground-raised-2)", borderColor: "var(--hairline)" }}
              >
                <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-4xl" style={{ background: "var(--ground)", boxShadow: "inset 0 0 0 2px var(--gold)" }}>{bot.emoji}</span>
                <span>
                  <span className="block text-xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>{bot.name}</span>
                  <span className="mb-1 block text-xs font-bold uppercase" style={{ color: "var(--gold)", letterSpacing: "0.12em" }}>{bot.level}</span>
                  <span className="block text-sm leading-snug" style={{ color: "var(--ink-dim)" }}>{bot.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-5 text-center text-xs" style={{ color: "var(--ink-faint)" }}>
          Bots see only their own cards and the same public table information as everyone else.
        </p>
      </motion.div>
    </div>
  );
}

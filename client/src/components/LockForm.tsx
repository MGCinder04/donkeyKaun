import type { FormEvent } from "react";
import { Button } from "./Button";

interface LockFormProps {
  passcode: string;
  onPasscodeChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  submitting: boolean;
  error: string;
}

export function LockForm({ passcode, onPasscodeChange, onSubmit, submitting, error }: LockFormProps) {
  return (
    <section className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
      <p className="mb-1 text-xs font-semibold uppercase" style={{ color: "var(--gold)", letterSpacing: "0.16em" }}>
        Donkey Kaun
      </p>
      <h2 className="mb-2 text-2xl font-bold">Family game night</h2>
      <p className="mb-6 text-sm" style={{ color: "var(--ink-dim)" }}>
        Enter the passcode to continue.
      </p>
      <form onSubmit={onSubmit} className="w-full max-w-xs">
        <input
          id="passcode"
          name="passcode"
          type="password"
          inputMode="text"
          autoComplete="off"
          autoFocus
          value={passcode}
          onChange={(e) => onPasscodeChange(e.target.value)}
          placeholder="Passcode"
          aria-label="Passcode"
          className="w-full rounded-full px-5 py-3 text-center text-sm"
          style={{ background: "var(--ground-raised)", border: "1px solid var(--hairline)", color: "var(--ink)" }}
        />
        <Button type="submit" disabled={submitting || !passcode} className="mt-4 w-full">
          {submitting ? "Checking…" : "Enter"}
        </Button>
        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--brick)" }}>
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

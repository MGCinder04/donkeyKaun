import { useNavigate } from "react-router-dom";
import { PlayingCardFan } from "../components/PlayingCardFan";
import { Button } from "../components/Button";
import { useIdentity, hasCompleteProfile } from "../identity/useIdentity";

export function Landing() {
  const navigate = useNavigate();
  const identity = useIdentity();
  const ready = hasCompleteProfile(identity);

  function go(next: "create" | "join") {
    navigate(ready ? `/${next}` : `/setup?next=${next}`);
  }

  return (
    <section className="mx-auto grid max-w-4xl gap-12 px-6 pt-24 pb-16 sm:grid-cols-[1.1fr_0.9fr] sm:items-center">
      <div>
        <p
          className="mb-4 text-xs font-semibold uppercase"
          style={{ color: "var(--gold)", letterSpacing: "0.16em" }}
        >
          🃏 Gupta Khaandaan's very own
        </p>
        <h1 className="text-5xl font-bold leading-[0.98] tracking-tight sm:text-6xl">
          Donkey
          <br />
          <em className="not-italic" style={{ color: "var(--gold-bright)", fontStyle: "italic" }}>
            Kaun
          </em>
        </h1>
        <p className="mt-6 max-w-[40ch] leading-relaxed" style={{ color: "var(--ink-dim)" }}>
          Deal the cards, call your bid, and find out who's the biggest donkey of all. 🫏
        </p>
        <div className="mt-9 flex flex-wrap gap-4">
          <Button variant="primary" onClick={() => go("create")}>
            🎉 Create a Room
          </Button>
          <Button variant="ghost" onClick={() => go("join")}>
            Join with a Code
          </Button>
        </div>
      </div>
      <PlayingCardFan />
    </section>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { useIdentity, hasCompleteProfile } from "../identity/useIdentity";
import { joinRoom } from "../rooms/roomClient";
import { ROOM_ERROR_MESSAGES } from "../rooms/errorMessages";

export function Join() {
  const navigate = useNavigate();
  const identity = useIdentity();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!hasCompleteProfile(identity)) {
      navigate("/setup?next=join", { replace: true });
    }
  }, [identity, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || !identity.avatar) return;
    setJoining(true);
    setError(null);
    const result = await joinRoom(trimmed, identity.name, identity.avatar, identity.deviceId);
    setJoining(false);
    if (result.ok) {
      navigate(`/room/${result.value.code}`);
    } else {
      setError(ROOM_ERROR_MESSAGES[result.error] ?? "Couldn't join that room.");
    }
  }

  return (
    <section className="mx-auto max-w-md px-6 pt-24 pb-16 text-center">
      <h2 className="text-2xl font-bold sm:text-3xl">Join with a code</h2>
      <p className="mt-2" style={{ color: "var(--ink-dim)" }}>
        Ask whoever's hosting for the room code.
      </p>
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col items-center gap-4">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={8}
          placeholder="ROOM CODE"
          aria-label="Room code"
          autoComplete="off"
          autoCapitalize="characters"
          className="w-full max-w-[220px] rounded-lg border px-3 py-3 text-center text-lg font-semibold tracking-[0.2em] outline-none"
          style={{
            background: "var(--ground-raised-2)",
            borderColor: "var(--hairline)",
            color: "var(--ink)",
            fontFamily: "var(--font-mono)",
          }}
        />
        {error && <p style={{ color: "var(--brick)" }}>{error}</p>}
        <div className="flex gap-4">
          <Button variant="ghost" type="button" onClick={() => navigate("/")}>
            Back
          </Button>
          <Button variant="primary" type="submit" disabled={!code.trim() || joining}>
            {joining ? "Joining…" : "Join"}
          </Button>
        </div>
      </form>
    </section>
  );
}

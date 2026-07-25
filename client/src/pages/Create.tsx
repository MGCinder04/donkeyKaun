import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { useIdentity, hasCompleteProfile } from "../identity/useIdentity";
import { createRoom } from "../rooms/roomClient";

export function Create() {
  const navigate = useNavigate();
  const identity = useIdentity();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!hasCompleteProfile(identity)) {
      navigate("/setup?next=create", { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;

    createRoom(identity.name, identity.avatar!, identity.deviceId).then((result) => {
      if (result.ok) {
        navigate(`/room/${result.value.code}`, { replace: true });
      } else {
        setError("Couldn't create a room right now. Check your connection and try again.");
      }
    });
  }, [identity, navigate]);

  return (
    <section className="mx-auto max-w-md px-6 pt-24 pb-16 text-center">
      {error ? (
        <>
          <h2 className="text-2xl font-bold sm:text-3xl">Something went wrong</h2>
          <p className="mt-3" style={{ color: "var(--ink-dim)" }}>
            {error}
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/")}>
              Back home
            </Button>
          </div>
        </>
      ) : (
        <p style={{ color: "var(--ink-dim)" }}>Creating your room…</p>
      )}
    </section>
  );
}

import { useEffect, useRef, useState, type FormEvent, type PropsWithChildren } from "react";
import { API_BASE } from "../lib/config";
import { getAuthToken, setAuthToken } from "../lib/authToken";
import { WaitingGame } from "./WaitingGame";
import { LockForm } from "./LockForm";

type Phase = "waking" | "locked" | "unlocking" | "ready";

const RETRY_DELAY_MS = 4000;
const REQUEST_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Gates the whole app behind the site passcode (if enabled) and, since the API server
 *  is a free Render instance that spins down when idle, doubles as the "waking up"
 *  screen — the very request that checks passcode status is also the one that wakes
 *  the server, so we poll it and keep the user entertained instead of staring at
 *  Render's own cold-start page (which we never see, since the client is now a static
 *  site that loads instantly on its own).
 *
 *  Auth here is a token in localStorage, sent as an explicit Authorization header —
 *  deliberately not a cookie. The client and API are separate origins, which makes a
 *  cookie a third-party cookie that mobile browsers block/evict regardless of its
 *  expiry, which is exactly what caused repeated re-prompting for the passcode. */
export function GateScreen({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<Phase>("waking");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (phase !== "waking") return;
    cancelledRef.current = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const token = getAuthToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetchWithTimeout(`${API_BASE}/api/session`, { headers }, REQUEST_TIMEOUT_MS);
        if (cancelledRef.current) return;
        if (res.ok) {
          const data = (await res.json()) as { unlocked: boolean };
          setPhase(data.unlocked ? "ready" : "locked");
          return;
        }
      } catch {
        // network hiccup or server still spinning up — fall through to retry
      }
      if (cancelledRef.current) return;
      setAttempt((a) => a + 1);
      timer = setTimeout(poll, RETRY_DELAY_MS);
    }

    poll();
    return () => {
      cancelledRef.current = true;
      clearTimeout(timer);
    };
  }, [phase]);

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    setPhase("unlocking");
    setError("");
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/api/unlock`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passcode }),
        },
        REQUEST_TIMEOUT_MS,
      );
      if (res.ok) {
        const data = (await res.json()) as { ok: true; token: string | null };
        setAuthToken(data.token);
        setPhase("ready");
      } else if (res.status === 429) {
        setError("Too many attempts. Try again later.");
        setPhase("locked");
      } else {
        setError("Wrong passcode.");
        setPhase("locked");
      }
    } catch {
      setError("Something went wrong. Try again.");
      setPhase("locked");
    }
  }

  if (phase === "ready") return <>{children}</>;

  if (phase === "waking") return <WaitingGame attempt={attempt} />;

  return (
    <LockForm
      passcode={passcode}
      onPasscodeChange={setPasscode}
      onSubmit={handleUnlock}
      submitting={phase === "unlocking"}
      error={error}
    />
  );
}

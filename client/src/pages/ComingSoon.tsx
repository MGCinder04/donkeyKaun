import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { useIdentity } from "../identity/useIdentity";

interface ComingSoonProps {
  title: string;
  detail: string;
}

export function ComingSoon({ title, detail }: ComingSoonProps) {
  const navigate = useNavigate();
  const identity = useIdentity();

  return (
    <section className="mx-auto max-w-xl px-6 pt-24 pb-16 text-center">
      {identity.avatar && (
        <p className="mb-6" style={{ color: "var(--ink-dim)" }}>
          Playing as <strong style={{ color: "var(--ink)" }}>{identity.name}</strong>
        </p>
      )}
      <h2 className="text-2xl font-bold sm:text-3xl">{title}</h2>
      <p className="mt-3" style={{ color: "var(--ink-dim)" }}>
        {detail}
      </p>
      <div className="mt-8 flex justify-center gap-4">
        <Button variant="ghost" onClick={() => navigate("/")}>
          Back home
        </Button>
      </div>
    </section>
  );
}

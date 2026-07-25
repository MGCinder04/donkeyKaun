import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";

interface ComingSoonProps {
  title: string;
  detail: string;
}

export function ComingSoon({ title, detail }: ComingSoonProps) {
  const navigate = useNavigate();

  return (
    <section className="mx-auto max-w-xl px-6 pt-24 pb-16 text-center">
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

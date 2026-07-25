import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AvatarPicker } from "../components/AvatarPicker";
import { Button } from "../components/Button";
import { AVATAR_CATALOG, COLOR_PALETTE } from "../identity/avatarCatalog";
import { useIdentity } from "../identity/useIdentity";
import type { AvatarChoice } from "../identity/useIdentity";

export function Setup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") === "join" ? "join" : "create";

  const identity = useIdentity();
  const [name, setName] = useState(identity.name);
  const [avatar, setAvatar] = useState<AvatarChoice>(
    identity.avatar ?? { catalogId: AVATAR_CATALOG[0].id, colorKey: COLOR_PALETTE[0].key },
  );

  const canContinue = name.trim().length > 0;

  function handleContinue() {
    if (!canContinue) return;
    identity.setName(name.trim());
    identity.setAvatar(avatar);
    navigate(`/${next}`);
  }

  return (
    <section className="mx-auto max-w-2xl px-6 pt-20 pb-16">
      <div className="mb-8">
        <h2 className="text-2xl font-bold sm:text-3xl">Choose your look</h2>
        <p className="mt-2" style={{ color: "var(--ink-dim)" }}>
          Pick an avatar and a name — we'll remember them on this device next time.
        </p>
      </div>

      <div
        className="rounded-2xl border p-6 sm:p-8"
        style={{ background: "var(--ground-raised)", borderColor: "var(--hairline)" }}
      >
        <input
          id="player-name"
          name="playerName"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="Your name"
          aria-label="Your name"
          className="mb-6 w-full max-w-[240px] rounded-lg border px-3 py-2.5 text-center outline-none"
          style={{
            background: "var(--ground-raised-2)",
            borderColor: "var(--hairline)",
            color: "var(--ink)",
          }}
          onKeyDown={(e) => e.key === "Enter" && handleContinue()}
        />
        <AvatarPicker value={avatar} onChange={setAvatar} />
      </div>

      <div className="mt-8 flex justify-end">
        <Button variant="primary" disabled={!canContinue} onClick={handleContinue}>
          Continue
        </Button>
      </div>
    </section>
  );
}

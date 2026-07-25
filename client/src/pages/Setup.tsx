import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AvatarPicker } from "../components/AvatarPicker";
import { Button } from "../components/Button";
import { AVATAR_CATALOG, COLOR_PALETTE, findCatalogEntry } from "../identity/avatarPalette";
import type { AvatarSelection } from "../identity/avatarPalette";
import { renderDicebearDataUri } from "../identity/dicebearRender";
import { useIdentity } from "../identity/useIdentity";
import type { AvatarChoice } from "../identity/useIdentity";

function resolveAvatarChoice(selection: AvatarSelection): AvatarChoice {
  const entry = findCatalogEntry(selection.catalogId);
  if (entry?.kind === "animal" && entry.emoji) {
    return { catalogId: selection.catalogId, colorKey: selection.colorKey, kind: "animal", preview: entry.emoji };
  }
  if (entry?.styleKey && entry.seed) {
    return {
      catalogId: selection.catalogId,
      colorKey: selection.colorKey,
      kind: "dicebear",
      preview: renderDicebearDataUri(entry.styleKey, entry.seed, selection.colorKey),
    };
  }
  const fallback = AVATAR_CATALOG[0];
  return {
    catalogId: fallback.id,
    colorKey: selection.colorKey,
    kind: "dicebear",
    preview: renderDicebearDataUri(fallback.styleKey!, fallback.seed!, selection.colorKey),
  };
}

export function Setup() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");

  const identity = useIdentity();
  const isEditing = identity.avatar !== null;
  const [name, setName] = useState(identity.name);
  const [selection, setSelection] = useState<AvatarSelection>(
    identity.avatar ?? { catalogId: AVATAR_CATALOG[0].id, colorKey: COLOR_PALETTE[0].key },
  );

  const canContinue = name.trim().length > 0;

  function handleContinue() {
    if (!canContinue) return;
    identity.setName(name.trim());
    identity.setAvatar(resolveAvatarChoice(selection));
    if (next === "create" || next === "join") {
      navigate(`/${next}`);
    } else {
      navigate(-1);
    }
  }

  return (
    <section className="mx-auto max-w-2xl px-6 pt-20 pb-16">
      <div className="mb-8">
        <h2 className="text-2xl font-bold sm:text-3xl">
          {isEditing ? "Update your look" : "Choose your look"}
        </h2>
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
        <AvatarPicker value={selection} onChange={setSelection} />
      </div>

      <div className="mt-8 flex justify-end">
        <Button variant="primary" disabled={!canContinue} onClick={handleContinue}>
          {isEditing ? "Save changes" : "Continue"}
        </Button>
      </div>
    </section>
  );
}

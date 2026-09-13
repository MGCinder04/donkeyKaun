import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AvatarPicker } from "../components/AvatarPicker";
import { Button } from "../components/Button";
import { AVATAR_CATALOG, COLOR_PALETTE, findCatalogEntry } from "../identity/avatarPalette";
import type { AvatarSelection } from "../identity/avatarPalette";
import { renderDicebearDataUri } from "../identity/dicebearRender";
import { randomGoofyName } from "../identity/goofyNames";
import { useIdentity } from "../identity/useIdentity";
import type { AvatarChoice } from "../identity/useIdentity";
import { unlockPrivateAssist } from "../rooms/roomClient";

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
  const roomCode = params.get("code");

  const identity = useIdentity();
  const isEditing = identity.avatar !== null;
  const [name, setName] = useState(identity.name);
  const [selection, setSelection] = useState<AvatarSelection>(
    identity.avatar ?? { catalogId: AVATAR_CATALOG[0].id, colorKey: COLOR_PALETTE[0].key },
  );
  const [privateNotice, setPrivateNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const enteredLength = name.trim().length;
  const isPrivateKeyCandidate = enteredLength >= 24;
  const canContinue = enteredLength > 0 && (enteredLength <= 20 || isPrivateKeyCandidate);

  function handleRandomize() {
    const avatar = AVATAR_CATALOG[Math.floor(Math.random() * AVATAR_CATALOG.length)];
    const color = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
    setName(randomGoofyName());
    setSelection({ catalogId: avatar.id, colorKey: color.key });
  }

  async function handleContinue() {
    if (!canContinue) return;
    if (isPrivateKeyCandidate) {
      setSaving(true);
      setPrivateNotice("");
      const result = await unlockPrivateAssist(name.trim());
      setSaving(false);
      if (!result.ok) {
        setPrivateNotice(
          result.error === "rate_limited"
            ? "Too many attempts. Try again later."
            : "That key did not unlock anything.",
        );
        return;
      }
      setName(identity.name);
      if (next === "room" && roomCode) navigate(`/room/${roomCode}`);
      else navigate(-1);
      return;
    }
    identity.setName(name.trim());
    identity.setAvatar(resolveAvatarChoice(selection));
    if (next === "room" && roomCode) {
      navigate(`/room/${roomCode}`);
    } else if (next === "create" || next === "join") {
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
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            id="player-name"
            name="playerName"
            autoComplete="off"
            type={isPrivateKeyCandidate ? "password" : "text"}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setPrivateNotice("");
            }}
            maxLength={64}
            placeholder="Your name"
            aria-label="Your name"
            className="w-full rounded-lg border px-3 py-2.5 text-center outline-none sm:max-w-[240px]"
            style={{
              background: "var(--ground-raised-2)",
              borderColor: "var(--hairline)",
              color: "var(--ink)",
            }}
            onKeyDown={(e) => e.key === "Enter" && void handleContinue()}
          />
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={handleRandomize}>
            🎲 Surprise me
          </Button>
        </div>
        <AvatarPicker value={selection} onChange={setSelection} />
        {privateNotice && (
          <p role="status" className="mt-5 text-center text-sm" style={{ color: "var(--brick)" }}>
            {privateNotice}
          </p>
        )}
      </div>

      <div className="mt-8 flex justify-end">
        <Button variant="primary" disabled={!canContinue || saving} onClick={() => void handleContinue()}>
          {saving ? "Checking…" : isEditing ? "Save changes" : "Continue"}
        </Button>
      </div>
    </section>
  );
}

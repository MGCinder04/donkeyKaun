import { useState } from "react";
import { AVATAR_CATALOG, COLOR_PALETTE } from "../identity/avatarPalette";
import { AvatarImage } from "./AvatarImage";
import type { AvatarSelection } from "../identity/avatarPalette";

interface AvatarPickerProps {
  value: AvatarSelection | null;
  onChange: (choice: AvatarSelection) => void;
}

export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  const [tab, setTab] = useState<"people" | "animals">("people");
  const selected = value ?? { catalogId: AVATAR_CATALOG[0].id, colorKey: COLOR_PALETTE[0].key };

  const tiles = AVATAR_CATALOG.filter((entry) =>
    tab === "people" ? entry.kind === "dicebear" : entry.kind === "animal",
  );

  function selectCatalog(catalogId: string) {
    onChange({ catalogId, colorKey: selected.colorKey });
  }

  function selectColor(colorKey: string) {
    onChange({ catalogId: selected.catalogId, colorKey });
  }

  return (
    <div className="grid gap-8 sm:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-center gap-4 text-center">
        <AvatarImage catalogId={selected.catalogId} colorKey={selected.colorKey} size={128} />
        <div className="flex gap-2">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-label={`Use ${c.key} accent`}
              onClick={() => selectColor(c.key)}
              className="h-6 w-6 rounded-full border-2 transition-transform hover:-translate-y-0.5"
              style={{
                background: `#${c.hex}`,
                borderColor: selected.colorKey === c.key ? "var(--gold-bright)" : "var(--hairline)",
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={() => setTab("people")}
            className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
            style={{
              background: tab === "people" ? "var(--gold)" : "var(--ground-raised-2)",
              color: tab === "people" ? "#1a1206" : "var(--ink-dim)",
            }}
          >
            People
          </button>
          <button
            type="button"
            onClick={() => setTab("animals")}
            className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
            style={{
              background: tab === "animals" ? "var(--gold)" : "var(--ground-raised-2)",
              color: tab === "animals" ? "#1a1206" : "var(--ink-dim)",
            }}
          >
            Animals
          </button>
        </div>
        <div className="grid max-h-72 grid-cols-6 gap-2 overflow-y-auto pr-1 sm:grid-cols-8">
          {tiles.map((entry) => {
            const isSelected = entry.id === selected.catalogId;
            const label =
              entry.kind === "animal"
                ? `Choose ${entry.emoji} avatar`
                : `Choose ${entry.styleKey} avatar, look ${entry.seed}`;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectCatalog(entry.id)}
                aria-label={label}
                aria-pressed={isSelected}
                className="aspect-square rounded-full p-0.5 transition-transform hover:-translate-y-0.5"
                style={{
                  boxShadow: isSelected ? "0 0 0 2px var(--gold-bright)" : "0 0 0 1px transparent",
                }}
              >
                <AvatarImage
                  catalogId={entry.id}
                  colorKey={selected.colorKey}
                  size={48}
                  className="h-full w-full"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

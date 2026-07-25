import { useState } from "react";
import { AVATAR_CATALOG, COLOR_PALETTE } from "../identity/avatarPalette";
import { AvatarImage } from "./AvatarImage";
import type { AvatarCategory, AvatarSelection } from "../identity/avatarPalette";

interface AvatarPickerProps {
  value: AvatarSelection | null;
  onChange: (choice: AvatarSelection) => void;
}

const CATEGORY_TABS: Array<{ key: AvatarCategory; label: string }> = [
  { key: "male", label: "Male" },
  { key: "female", label: "Female" },
  { key: "animal", label: "Animal" },
  { key: "misc", label: "Misc" },
];

export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  const [tab, setTab] = useState<AvatarCategory>("male");
  const selected = value ?? { catalogId: AVATAR_CATALOG[0].id, colorKey: COLOR_PALETTE[0].key };

  const tiles = AVATAR_CATALOG.filter((entry) => entry.category === tab);

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
        <div className="mb-3 flex flex-wrap gap-2">
          {CATEGORY_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="rounded-full px-4 py-1.5 text-sm font-semibold transition-colors"
              style={{
                background: tab === t.key ? "var(--gold)" : "var(--ground-raised-2)",
                color: tab === t.key ? "#1a1206" : "var(--ink-dim)",
              }}
            >
              {t.label}
            </button>
          ))}
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

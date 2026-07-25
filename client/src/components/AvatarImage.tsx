import { useMemo } from "react";
import {
  findCatalogEntry,
  renderDicebearDataUri,
  colorHex,
} from "../identity/avatarCatalog";

interface AvatarImageProps {
  catalogId: string;
  colorKey: string;
  size?: number;
  className?: string;
}

export function AvatarImage({ catalogId, colorKey, size = 56, className = "" }: AvatarImageProps) {
  const entry = findCatalogEntry(catalogId);

  const src = useMemo(() => {
    if (!entry || entry.kind !== "dicebear" || !entry.styleKey || !entry.seed) return null;
    return renderDicebearDataUri(entry.styleKey, entry.seed, colorKey);
  }, [entry, colorKey]);

  if (!entry) return null;

  if (entry.kind === "animal") {
    return (
      <div
        className={`flex items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size, background: `#${colorHex(colorKey)}33`, fontSize: size * 0.55 }}
      >
        {entry.emoji}
      </div>
    );
  }

  return (
    <img
      src={src ?? undefined}
      width={size}
      height={size}
      alt=""
      className={`rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

import { colorHex } from "../identity/avatarPalette";
import type { AvatarChoice } from "../identity/useIdentity";

interface AvatarThumbProps {
  avatar: AvatarChoice;
  size?: number;
  className?: string;
}

export function AvatarThumb({ avatar, size = 40, className = "" }: AvatarThumbProps) {
  if (avatar.kind === "animal") {
    return (
      <div
        className={`flex items-center justify-center rounded-full ${className}`}
        style={{ width: size, height: size, background: `#${colorHex(avatar.colorKey)}33`, fontSize: size * 0.55 }}
      >
        {avatar.preview}
      </div>
    );
  }

  return (
    <img
      src={avatar.preview}
      width={size}
      height={size}
      alt=""
      className={`rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

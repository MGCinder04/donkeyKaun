import { useLocation, useNavigate } from "react-router-dom";
import { AvatarThumb } from "./AvatarThumb";
import { useIdentity } from "../identity/useIdentity";

export function ProfileBadge() {
  const navigate = useNavigate();
  const location = useLocation();
  const identity = useIdentity();

  if (!identity.avatar) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const roomMatch = location.pathname.match(/^\/room\/([A-Za-z0-9]+)$/);
        navigate(roomMatch ? `/setup?next=room&code=${roomMatch[1].toUpperCase()}` : "/setup");
      }}
      aria-label={`Playing as ${identity.name}. Click to change your name or avatar.`}
      className="flex items-center gap-2 rounded-full border py-1 pr-4 pl-1 transition-transform hover:-translate-y-0.5"
      style={{ borderColor: "var(--hairline)", background: "var(--ground-raised)" }}
    >
      <AvatarThumb avatar={identity.avatar} size={32} />
      <span className="max-w-[8rem] truncate text-sm font-semibold" style={{ color: "var(--ink)" }}>
        {identity.name}
      </span>
    </button>
  );
}

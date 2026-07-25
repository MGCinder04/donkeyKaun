import { useLocation } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { ProfileBadge } from "./ProfileBadge";

export function TopBar() {
  const location = useLocation();
  const hideProfileBadge = location.pathname === "/setup";

  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      <ThemeToggle />
      {!hideProfileBadge && <ProfileBadge />}
    </div>
  );
}

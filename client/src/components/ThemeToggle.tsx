import { useEffect } from "react";
import { useTheme, resolvedTheme } from "../theme/useTheme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = resolvedTheme(theme);

  useEffect(() => {
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => setTheme(current === "dark" ? "light" : "dark")}
      aria-label={current === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="flex h-9 w-9 items-center justify-center rounded-full border text-base transition-transform hover:-translate-y-0.5"
      style={{ borderColor: "var(--hairline)", background: "var(--ground-raised)", color: "var(--ink)" }}
    >
      {current === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

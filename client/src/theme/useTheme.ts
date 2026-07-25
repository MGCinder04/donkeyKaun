import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeChoice = "light" | "dark";

interface ThemeState {
  theme: ThemeChoice | null;
  setTheme: (theme: ThemeChoice) => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: null,
      setTheme: (theme) => set({ theme }),
    }),
    { name: "dk-theme" },
  ),
);

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvedTheme(theme: ThemeChoice | null): ThemeChoice {
  return theme ?? (systemPrefersDark() ? "dark" : "light");
}

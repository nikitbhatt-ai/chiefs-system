"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  THEMES,
  THEME_HINTS,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  isTheme,
  type Theme,
} from "@/lib/theme";

// Three-way theme picker for the app header.
//
// The active theme is already on <html> before this mounts (see the bootstrap
// script in the root layout), so this reads the live attribute rather than
// applying anything on load — applying on mount would fight the script and
// cause a visible flip.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(isTheme(current) ? current : DEFAULT_THEME);
  }, []);

  function choose(next: Theme) {
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private-mode storage failure shouldn't break the switch for this tab.
    }
    setTheme(next);
  }

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex items-center rounded-lg border border-white/10 overflow-hidden"
    >
      {THEMES.map((t) => {
        // `theme` is null for the first paint (before the effect runs). Render
        // nothing as selected then, so the server and client markup agree and
        // React doesn't warn about a hydration mismatch.
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => choose(t)}
            aria-pressed={active}
            title={THEME_HINTS[t]}
            className={`px-2.5 py-1.5 text-[11px] font-body transition-colors ${
              active
                ? "bg-amber-500 text-black font-semibold"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            {THEME_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_NIGHT_THEME,
  DEFAULT_THEME,
  NIGHT_THEME_STORAGE_KEY,
  THEME_STORAGE_KEY,
  isNightTheme,
  isTheme,
  type NightTheme,
  type Theme,
} from "@/lib/theme";

// One-button day/night switch for the app header.
//
// The icon shows what you'll GET, not where you are — a sun means "click for
// day". That's the convention most apps use, and it makes the button
// self-explanatory without a label.
//
// There are two dark themes (Dark and Black) but only one moon, so the night
// side resolves to whichever the user last had. Someone on Black stays on Black
// when they flip back and forth; see NIGHT_THEME_STORAGE_KEY.
export function ThemeToggle() {
  // null until the effect runs, so the first client render matches the server
  // and React doesn't flag a hydration mismatch.
  const [theme, setTheme] = useState<Theme | null>(null);
  const [nightTheme, setNightTheme] = useState<NightTheme>(DEFAULT_NIGHT_THEME);

  useEffect(() => {
    // The bootstrap script already put the right theme on <html>; read it
    // rather than re-applying, or the two fight and the page visibly flips.
    const current = document.documentElement.getAttribute("data-theme");
    const resolved = isTheme(current) ? current : DEFAULT_THEME;
    setTheme(resolved);

    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(NIGHT_THEME_STORAGE_KEY);
    } catch {
      // Private-mode storage — fall through to the default.
    }
    // Landing on a dark theme makes that the night side, so a first-ever
    // toggle to day and back returns you where you started.
    setNightTheme(
      isNightTheme(remembered)
        ? remembered
        : isNightTheme(resolved)
          ? resolved
          : DEFAULT_NIGHT_THEME,
    );
  }, []);

  const isDay = theme === "day";

  function toggle() {
    const next: Theme = isDay ? nightTheme : "day";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      if (isNightTheme(next)) localStorage.setItem(NIGHT_THEME_STORAGE_KEY, next);
    } catch {
      // Switch still applies for this tab even if it can't be persisted.
    }
    setTheme(next);
  }

  // Render the button before the theme is known so the header doesn't reflow on
  // hydration; it just shows the moon until the effect resolves.
  const label = isDay ? "Switch to night mode" : "Switch to day mode";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center text-zinc-400 hover:text-white border border-white/10 rounded-lg px-2.5 py-1.5 transition-colors cursor-pointer"
    >
      {isDay ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13.5 9.7A5.8 5.8 0 1 1 6.3 2.5a4.6 4.6 0 0 0 7.2 7.2z" />
    </svg>
  );
}

// Theme definitions, shared by the no-flash bootstrap script and the picker.
// The actual colours live in src/app/globals.css under `[data-theme="…"]`.

export const THEMES = ["dark", "black", "day"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "dark";

export const THEME_STORAGE_KEY = "chiefs-theme";

/**
 * Which dark theme the sun/moon button returns to.
 *
 * The header control is a plain two-state flip — day ⇄ night — but there are
 * two dark themes. Remembering the last one used means someone who picked
 * Black keeps Black as their night side instead of being silently moved to
 * Dark the first time they toggle.
 */
export const NIGHT_THEME_STORAGE_KEY = "chiefs-theme-night";

export const DEFAULT_NIGHT_THEME: NightTheme = "dark";

/** The non-day themes — i.e. anything the moon side can resolve to. */
export type NightTheme = Exclude<Theme, "day">;

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
}

export function isNightTheme(v: unknown): v is NightTheme {
  return v === "dark" || v === "black";
}

/**
 * Runs blocking in <head> before first paint, so the correct theme is on
 * <html> before anything renders — otherwise a Day-mode user gets a dark flash
 * on every navigation. Kept tiny and dependency-free for that reason, and
 * wrapped in try/catch because localStorage throws in some privacy modes.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(t!==${JSON.stringify("dark")}&&t!==${JSON.stringify("black")}&&t!==${JSON.stringify("day")})t=${JSON.stringify(DEFAULT_THEME)};
document.documentElement.setAttribute("data-theme",t);
}catch(e){document.documentElement.setAttribute("data-theme",${JSON.stringify(DEFAULT_THEME)});}})();
`.trim();

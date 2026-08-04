// Theme definitions, shared by the no-flash bootstrap script and the picker.
// The actual colours live in src/app/globals.css under `[data-theme="…"]`.

export const THEMES = ["dark", "black", "day"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "dark";

export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  black: "Black",
  day: "Day",
};

export const THEME_HINTS: Record<Theme, string> = {
  dark: "Deep navy — the original look",
  black: "True black, soft-toned text",
  day: "Cream paper, navy ink",
};

export const THEME_STORAGE_KEY = "chiefs-theme";

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (THEMES as readonly string[]).includes(v);
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

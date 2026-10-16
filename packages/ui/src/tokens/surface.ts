/**
 * surface.ts -- the profile and theme a root or an overlay portal carries, which select the tokens every shared component reads.
 *
 * `tokens.css` keys each app's roles on `data-luke-profile` and its palette
 * on `data-luke-theme`, so a surface is two attributes: the window's root
 * and anything it portals into `document.body` carry the same pair, and a
 * dialog reads the window's tokens rather than none.
 */

/** Which app's roles a surface is drawn at: the desktop's density, or the site's. */
export const PROFILE = {
  DESKTOP: "desktop",
  WEB: "web",
} as const;

export type Profile = (typeof PROFILE)[keyof typeof PROFILE];

/** Which palette a surface is drawn in; `system` follows the Mac's appearance and is the desktop's. */
export const THEME = {
  DARK: "dark",
  LIGHT: "light",
  SYSTEM: "system",
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

/**
 * The themes a surface at `profile` may be drawn in. The site keeps a
 * palette per theme and none that follows the machine, so `system` is the
 * desktop's alone: a web surface asking for it would take the machine's
 * native controls over a page that stays light.
 */
export type ThemeOf<P extends Profile> = P extends typeof PROFILE.WEB
  ? Exclude<Theme, typeof THEME.SYSTEM>
  : Theme;

/** The attributes a surface's root wears for `profile` in `theme`. */
export interface SurfaceAttributes {
  readonly "data-luke-profile": Profile;
  readonly "data-luke-theme": Theme;
}

/** The attributes a root or a portal spreads to be drawn at `profile` in `theme`. */
export function surfaceAttributes<P extends Profile>(
  profile: P,
  theme: ThemeOf<P>,
): SurfaceAttributes {
  return { "data-luke-profile": profile, "data-luke-theme": theme };
}

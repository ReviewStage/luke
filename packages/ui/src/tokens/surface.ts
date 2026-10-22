/**
 * surface.ts -- the profile and theme a root or an overlay portal carries, which select the tokens every shared component reads.
 *
 * `tokens.css` keys each app's roles on `data-luke-profile` and its palette
 * on `data-luke-theme`, so a surface is two attributes: the window's root
 * and anything it portals into `document.body` carry the same pair, and a
 * dialog reads the window's tokens rather than none. A web surface may carry
 * a third, `data-luke-density`, which sets the site's roles at a denser size.
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
 * How densely a web surface is drawn, where it is not at the site's own
 * size: `compact` is a dashboard's, its controls and type a step under a
 * public page's. The desktop has one density, its own. Note that compact
 * holds only with a fine pointer: on a coarse one the site's full size
 * stands (`profiles.css`), so a root may ask for compact and a finger still
 * meets controls and words sized for it.
 */
export const DENSITY = {
  COMPACT: "compact",
} as const;

export type Density = (typeof DENSITY)[keyof typeof DENSITY];

/**
 * The themes a surface at `profile` may be drawn in. The site keeps a
 * palette per theme and none that follows the machine, so `system` is the
 * desktop's alone: a web surface asking for it would take the machine's
 * native controls over a page that stays light.
 */
export type ThemeOf<P extends Profile> = P extends typeof PROFILE.WEB
  ? Exclude<Theme, typeof THEME.SYSTEM>
  : Theme;

/** The densities a surface at `profile` may be drawn at: the site's alone has more than one. */
export type DensityOf<P extends Profile> = P extends typeof PROFILE.WEB ? Density : never;

/** The attributes a surface's root wears for `profile` in `theme`, at `density` where it has one. */
export interface SurfaceAttributes {
  readonly "data-luke-profile": Profile;
  readonly "data-luke-theme": Theme;
  readonly "data-luke-density"?: Density;
}

/** The attributes a root or a portal spreads to be drawn at `profile` in `theme`, and `density` where given. */
export function surfaceAttributes<P extends Profile>(
  profile: P,
  theme: ThemeOf<P>,
  density?: DensityOf<P>,
): SurfaceAttributes {
  const surface = { "data-luke-profile": profile, "data-luke-theme": theme };
  return density === undefined ? surface : { ...surface, "data-luke-density": density };
}

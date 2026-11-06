export const PROFILE = {
  DESKTOP: "desktop",
  WEB: "web",
} as const;

export type Profile = (typeof PROFILE)[keyof typeof PROFILE];

export const THEME = {
  DARK: "dark",
  LIGHT: "light",
  SYSTEM: "system",
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

export const DENSITY = {
  COMPACT: "compact",
} as const;

export type Density = (typeof DENSITY)[keyof typeof DENSITY];

export type ThemeOf<P extends Profile> = P extends typeof PROFILE.WEB
  ? Exclude<Theme, typeof THEME.SYSTEM>
  : Theme;

export type DensityOf<P extends Profile> = P extends typeof PROFILE.WEB ? Density : never;

export interface SurfaceAttributes {
  readonly "data-ui-profile": Profile;
  readonly "data-ui-theme": Theme;
  readonly "data-ui-density"?: Density;
}

export function surfaceAttributes<P extends Profile>(
  profile: P,
  theme: ThemeOf<P>,
  density?: DensityOf<P>,
): SurfaceAttributes {
  const surface = { "data-ui-profile": profile, "data-ui-theme": theme };
  return density === undefined ? surface : { ...surface, "data-ui-density": density };
}

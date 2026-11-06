export const ICON_SIZE = {
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
  EMPTY: "empty",
} as const;

export type IconSize = (typeof ICON_SIZE)[keyof typeof ICON_SIZE];

export const ICON_STROKE_WIDTH = 1.9;

export const CALENDAR_PLACE = {
  SINGLE: "single",
  START: "start",
  END: "end",
  BETWEEN: "between",
} as const;

export type CalendarPlace = (typeof CALENDAR_PLACE)[keyof typeof CALENDAR_PLACE];

export const CALENDAR = "inline-flex flex-col gap-ui-8";

export const CALENDAR_CAPTION = "flex items-center justify-between gap-control-gap ps-ui-6";

export const CALENDAR_CAPTION_LABEL = "font-sans text-label font-section text-foreground";

export const CALENDAR_NAV = "flex gap-ui-2";

export const CALENDAR_MONTH_GRID = "table-fixed border-separate border-spacing-0";

export const CALENDAR_WEEKDAY =
  "h-control w-control p-0 text-center font-sans text-tag font-tag text-muted-foreground";

export const CALENDAR_DAY = "w-control p-0";

export const CALENDAR_RANGE: Readonly<Record<CalendarPlace, string>> = {
  [CALENDAR_PLACE.SINGLE]: "",
  [CALENDAR_PLACE.START]:
    "bg-linear-to-r from-transparent from-50% to-fill-selected to-50% last:rounded-e-control",
  [CALENDAR_PLACE.END]:
    "bg-linear-to-l from-transparent from-50% to-fill-selected to-50% first:rounded-s-control",
  [CALENDAR_PLACE.BETWEEN]: "bg-fill-selected first:rounded-s-control last:rounded-e-control",
};

export const CALENDAR_DAY_BUTTON =
  "relative z-0 m-0 flex h-control w-full cursor-press items-center justify-center rounded-none border-0 bg-transparent p-0 font-sans focus-visible:rounded-control text-body tabular-nums before:absolute before:inset-0 before:-z-1 before:rounded-control before:transition-colors before:duration-(--ui-duration-hover) before:ease-motion-exit before:content-['']";

export const CALENDAR_DAY_FACE = {
  OPEN: "hover:before:bg-muted",
  PICKED: "before:bg-accent-fill",
} as const;

export const CALENDAR_DAY_INK = {
  PICKED: "text-on-accent",
  TODAY: "text-accent-ink",
  OUTSIDE: "text-muted-foreground",
  OWN: "text-foreground",
} as const;

export const CALENDAR_TODAY =
  "font-emphasis after:absolute after:bottom-ui-2 after:left-1/2 after:size-ui-4 after:-translate-x-1/2 after:rounded-full after:bg-current after:content-['']";

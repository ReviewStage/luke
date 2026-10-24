/**
 * calendar.ts -- shadcn/ui's calendar (style `base-nova`), its drawing alone, in Luke's month grid.
 *
 * What is kept of `shadcn add calendar` is the drawing its `classNames` hand
 * react-day-picker: the month, its caption, its nav, the weekday headings,
 * a day's cell and button, a range's start, middle, and end, today, and a
 * neighbouring month's days, each a class string here, so a later `shadcn
 * add calendar` reads as a small diff against them. react-day-picker and
 * date-fns are left out, because `@luke/ui`'s `Calendar` is controlled on
 * `YYYY-MM-DD` days read in UTC, pages through the four-digit years alone,
 * and steps the keyboard into a month its caller shows renders later
 * (`components/calendar/calendar.tsx`), none of which react-day-picker's
 * local dates and own focus keep.
 *
 * Luke's changes, against shadcn's own strings: the grid is a table of
 * square cells a control's height across, the caption a label's semibold
 * at the start with the two steps at the end rather than a centred label
 * between them; a day's face is drawn behind its number (`before:`), lit
 * under the pointer, filled in the accent where it is a single pick or a
 * range's end, while the days between wash their cells edge to edge, the
 * ends washing their inner half, a band rounding where a week ends it;
 * today is the accent's ink with a dot under its number; and a
 * neighbouring month's days are subtle. The keyboard's ring, inside the
 * day since its neighbours stand against it, is `calendar.css`'s, the
 * day rounding to its face while the ring stands.
 */

/** Where a day stands against the selection, which its cell's wash and its face are drawn from. */
export const CALENDAR_PLACE = {
  SINGLE: "single",
  START: "start",
  END: "end",
  BETWEEN: "between",
} as const;

export type CalendarPlace = (typeof CALENDAR_PLACE)[keyof typeof CALENDAR_PLACE];

/** The month: its caption over its grid. */
export const CALENDAR = "inline-flex flex-col gap-luke-8";

/** The caption: the month's name at the start, its steps at the end. */
export const CALENDAR_CAPTION = "flex items-center justify-between gap-control-gap ps-luke-6";

/** The month's name. */
export const CALENDAR_CAPTION_LABEL = "font-sans text-label font-semibold text-foreground";

/** The previous and next steps, a hair apart. */
export const CALENDAR_NAV = "flex gap-luke-2";

/** The grid, its cells' spacing cleared to the seven columns, its borders apart so a band's ends round. */
export const CALENDAR_MONTH_GRID = "table-fixed border-separate border-spacing-0";

/** A weekday's heading over its column. */
export const CALENDAR_WEEKDAY =
  "h-control w-control p-0 text-center font-sans text-caption font-medium text-subtle-foreground";

/** A day's cell, a control's height across. */
export const CALENDAR_DAY = "w-control p-0";

/** A cell's wash by where its day stands in a range: the days between edge to edge, the ends their inner half, rounding where a week ends the band. */
export const CALENDAR_RANGE: Readonly<Record<CalendarPlace, string>> = {
  [CALENDAR_PLACE.SINGLE]: "",
  [CALENDAR_PLACE.START]:
    "bg-linear-to-r from-transparent from-50% to-fill-selected to-50% last:rounded-e-control",
  [CALENDAR_PLACE.END]:
    "bg-linear-to-l from-transparent from-50% to-fill-selected to-50% first:rounded-s-control",
  [CALENDAR_PLACE.BETWEEN]: "bg-fill-selected first:rounded-s-control last:rounded-e-control",
};

/** A day's button: its number over the face drawn behind it. */
export const CALENDAR_DAY_BUTTON =
  "relative z-0 m-0 flex h-control w-full cursor-pointer items-center justify-center rounded-none border-0 bg-transparent p-0 font-sans focus-visible:rounded-control text-body tabular-nums before:absolute before:inset-0 before:-z-1 before:rounded-control before:transition-colors before:duration-(--luke-duration-hover) before:ease-motion-exit before:content-[''] in-data-[luke-profile=desktop]:cursor-default";

/** A day's face: lit under the pointer, or filled in the accent where it is picked. */
export const CALENDAR_DAY_FACE = {
  OPEN: "hover:before:bg-muted",
  PICKED: "before:bg-accent-fill",
} as const;

/** A day's ink: on the accent where picked, then today's accent, then a neighbouring month's subtle, then the text's own. */
export const CALENDAR_DAY_INK = {
  PICKED: "text-on-accent",
  TODAY: "text-accent-ink",
  OUTSIDE: "text-subtle-foreground",
  OWN: "text-foreground",
} as const;

/** Today: semibold, a dot under its number in whatever ink the number is. */
export const CALENDAR_TODAY =
  "font-semibold after:absolute after:bottom-luke-2 after:left-1/2 after:size-luke-4 after:-translate-x-1/2 after:rounded-full after:bg-current after:content-['']";

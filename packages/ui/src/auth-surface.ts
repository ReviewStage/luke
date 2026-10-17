/**
 * The button the admin dashboard's sign-in cards draw, from the dark OAuth
 * vocabulary the auth pages used before they moved onto AuthPage. The admin
 * cards are its last caller.
 */

/**
 * `cursor-pointer` is carried here rather than inherited: Tailwind's preflight
 * leaves a button on the user agent's own arrow.
 */
export const AUTH_BUTTON =
  "min-h-[46px] cursor-pointer rounded-md border border-border bg-card font-semibold transition-[background-color,transform] duration-150 hover:not-disabled:-translate-y-px hover:not-disabled:bg-muted disabled:cursor-wait disabled:opacity-[0.56] motion-reduce:transition-none";

/**
 * The card the sign-in and consent windows are drawn as. Both pages sit in
 * the same dark OAuth vocabulary, so the surface is written once here
 * rather than twice at two call sites that would drift.
 *
 * Deliberately not a component: the two pages differ in what the card holds,
 * not in what it is, and a wrapper that took children would earn nothing but
 * a level of nesting.
 */

/** A single card, centered in the window, with nothing else on the page. */
export const AUTH_SHELL = "grid min-h-screen place-items-center p-6";

export const AUTH_CARD =
  "w-full max-w-[430px] rounded-lg border border-border bg-card px-8 py-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.42)]";

export const AUTH_TITLE = "mt-4 mb-2 text-[1.75rem] leading-[1.15] font-semibold";

/**
 * `cursor-pointer` is carried here rather than inherited: Tailwind's preflight
 * leaves a button on the user agent's own arrow.
 */
export const AUTH_BUTTON =
  "min-h-[46px] cursor-pointer rounded-md border border-border bg-card font-semibold transition-[background-color,transform] duration-150 hover:not-disabled:-translate-y-px hover:not-disabled:bg-muted disabled:cursor-wait disabled:opacity-[0.56] motion-reduce:transition-none";

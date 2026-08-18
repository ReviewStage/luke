/**
 * The card the sign-in and consent windows are drawn as. Both pages are the
 * same object at two moments of one flow, so the surface is written once here
 * rather than twice at two call sites that would drift.
 *
 * Deliberately not a component: the two pages differ in what the card holds,
 * not in what it is, and a wrapper that took children would earn nothing but
 * a level of nesting.
 */

/** A single card, centered in the window, with nothing else on the page. */
export const AUTH_SHELL = "grid min-h-screen place-items-center p-6";

export const AUTH_CARD =
  "w-full max-w-[390px] rounded-lg border border-border bg-card px-8 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]";

export const AUTH_TITLE = "mt-4 mb-2 text-[1.75rem] leading-[1.15] font-semibold";

/**
 * `data-tone` carries the state rather than a computed class, so the pill
 * says what it means in the markup and the palette stays in one string.
 */
export const AUTH_PILL =
  "mt-4 inline-block rounded-full bg-complete-tint px-[11px] py-[3px] font-mono text-xs font-semibold tracking-[0.2px] text-complete data-[tone=attention]:bg-attention-tint data-[tone=attention]:text-attention";

/**
 * `cursor-pointer` is carried here rather than inherited: Tailwind's preflight
 * leaves a button on the user agent's own arrow, where the sheet this replaced
 * reset every button to a pointer.
 */
export const AUTH_BUTTON =
  "min-h-[46px] cursor-pointer rounded-md border border-border bg-card font-semibold transition-[background-color,transform] duration-150 hover:not-disabled:-translate-y-px hover:not-disabled:bg-muted disabled:cursor-wait disabled:opacity-[0.56] motion-reduce:transition-none";

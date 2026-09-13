export function announceAfter(delayMillis: number, say: () => void): void {
  setTimeout(say, delayMillis);
}

/** A raw timer held behind a fallback is still a raw timer: the identifier escapes as an operand, never called directly. */
export function armWithFallback(
  say: () => void,
  delayMillis: number,
  schedule?: (callback: () => void, delayMs: number) => number,
): void {
  (schedule ?? setTimeout)(say, delayMillis);
}

/** The same escape for a constructor: held rather than named after `new`. */
export function controllerOrNothing(build?: () => AbortController): AbortController {
  return (build ?? AbortController)();
}

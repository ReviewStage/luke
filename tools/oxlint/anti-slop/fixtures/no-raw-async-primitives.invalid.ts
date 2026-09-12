export function announceAfter(delayMillis: number, say: () => void): void {
  setTimeout(say, delayMillis);
}

const DURATION_FAST = "--ui-duration-fast";

export function holdMotion(): void {
  document.documentElement.style.setProperty(DURATION_FAST, "1ms");
}

export function releaseMotion(): void {
  document.documentElement.style.removeProperty(DURATION_FAST);
}

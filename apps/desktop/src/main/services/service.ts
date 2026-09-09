/**
 * One concern of the desktop client: what it begins at launch, and what it
 * gives back at quit. Nothing here starts while its module loads — the
 * composition constructs, `main` starts, and a quit stops in the reverse
 * order — so a launch's order is a sequence a reader can follow rather than
 * the order eight files happened to be evaluated in.
 */
export interface DesktopService {
  /** Names this concern in a failure report and in the order the set starts and stops in. */
  readonly name: string;
  start: () => Promise<void>;
  /**
   * Gives back exactly what `start` began — every timer, watcher, global
   * shortcut, subscription, and helper process — and leaves no handle behind.
   * Safe to call when `start` never ran, and safe to call twice: a quit that
   * interrupted a launch stops a set only half of which began.
   */
  stop: () => Promise<void>;
}

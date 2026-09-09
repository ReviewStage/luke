/**
 * Whether the hidden voice renderer can receive anything right now, as the
 * main process alone decides it. A BrowserWindow standing is not a receiver:
 * between its load and the renderer's subscriptions there is a window in
 * which every send lands on nothing, and a reload, crash, or replacement
 * reopens that window on a renderer the main process cannot tell from the
 * last one by its handle alone. So each load is given an epoch here, begins
 * unready, and becomes ready only when the renderer of that same epoch says
 * its bootstrap is applied and its subscriptions stand. Every epoch change
 * makes the receiver unready again; whatever was offered to the old epoch is
 * the caller's to reoffer once a new one reports.
 */
import { type IDisposable, toDisposable } from "@sidecar/wire";

export type VoiceReceiverListener = (epoch: number) => void;

export class VoiceReceiver {
  #epoch = 0;
  /** Whether a renderer has been begun and not since ended; no report counts otherwise. */
  #open = false;
  #ready = false;
  readonly #readyListeners = new Set<VoiceReceiverListener>();
  readonly #resetListeners = new Set<VoiceReceiverListener>();

  /** Begins a new epoch for a renderer about to load, unready, and answers it. */
  begin(): number {
    this.#end();
    this.#epoch += 1;
    this.#open = true;
    return this.#epoch;
  }

  /** Ends the current epoch: the renderer is gone, reloading, or being replaced. */
  reset(): void {
    this.#end();
    this.#epoch += 1;
  }

  epoch(): number {
    return this.#epoch;
  }

  isReady(): boolean {
    return this.#ready;
  }

  /**
   * Takes a renderer's report that it can receive. Only the current epoch's
   * report counts, and only its first: a stale one names a renderer that no
   * longer stands, and a repeat changes nothing. Answers whether this report
   * is the one that made the receiver ready.
   */
  markReady(epoch: number): boolean {
    if (!this.#open || epoch !== this.#epoch || this.#ready) return false;
    this.#ready = true;
    for (const listener of [...this.#readyListeners]) listener(epoch);
    return true;
  }

  onReady(listener: VoiceReceiverListener): IDisposable {
    this.#readyListeners.add(listener);
    return toDisposable(() => {
      this.#readyListeners.delete(listener);
    });
  }

  /** Hears every epoch ending, with the epoch that ended, after a reset or a new beginning. */
  onReset(listener: VoiceReceiverListener): IDisposable {
    this.#resetListeners.add(listener);
    return toDisposable(() => {
      this.#resetListeners.delete(listener);
    });
  }

  #end(): void {
    const ended = this.#epoch;
    this.#open = false;
    this.#ready = false;
    for (const listener of [...this.#resetListeners]) listener(ended);
  }
}

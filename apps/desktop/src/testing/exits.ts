/**
 * exits.ts -- jsdom runs no animations, so a test of something held through its exit stands in for the engine: each element matching a selector runs one exit the test finishes or cancels.
 */

/** One exit the stand-in is running, ended by the test as the stylesheet's would end or a reopening would cut it short. */
export interface Exit {
  readonly finish: () => void;
  readonly cancel: () => void;
}

/** Installs the stand-in; the exits it starts are pushed onto the list it answers, in the order they start. */
export function installExits(selector: string): Exit[] {
  const exits: Exit[] = [];
  const running = new Map<Element, Animation>();
  Element.prototype.getAnimations = function (this: Element) {
    if (!this.matches(selector)) return [];
    const standing = running.get(this);
    if (standing !== undefined) return [standing];
    const events = new EventTarget();
    // SAFETY: a hold listens for an animation's `finish` and `cancel` and reads nothing else of it.
    const exit = events as Animation;
    running.set(this, exit);
    exits.push({
      finish: () => events.dispatchEvent(new Event("finish")),
      cancel: () => events.dispatchEvent(new Event("cancel")),
    });
    return [exit];
  };
  return exits;
}

/** Takes the stand-in away again. */
export function uninstallExits(): void {
  Reflect.deleteProperty(Element.prototype, "getAnimations");
}

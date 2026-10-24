/**
 * held-exits.ts -- an exit that runs under jsdom until the test finishes it: jsdom runs no motion, so an element leaving would be taken at once.
 *
 * Every element marked `data-leaving`, or in Base UI's ending state
 * (`data-ending-style`), or that `exiting` names, answers `getAnimations`
 * with one running exit, as the engine would while its stylesheet's exit
 * plays; `finish` ends every exit handed out, both as a held disclosure
 * hears it (its `finish` event) and as Base UI does (its `finished`
 * promise), and `restore` takes the engine away.
 */

/** Whether an element is leaving: marked so, as a held disclosure is, or ending, as a Base UI popup is. */
function marked(element: Element): boolean {
  return (
    element.getAttribute("data-leaving") === "true" || element.hasAttribute("data-ending-style")
  );
}

/** One running exit, as much of an `Animation` as a held disclosure and Base UI read. */
class HeldExit extends EventTarget {
  readonly pending = false;
  playState = "running";
  readonly effect = { getTiming: () => ({ duration: 90, iterations: 1 }) };
  readonly #settled = Promise.withResolvers<void>();
  readonly finished = this.#settled.promise;

  finish(): void {
    this.playState = "finished";
    this.#settled.resolve();
    this.dispatchEvent(new Event("finish"));
  }
}

export function holdExits(exiting: (element: Element) => boolean = marked) {
  const exits: HeldExit[] = [];
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value(this: Element) {
      if (!exiting(this)) return [];
      const exit = new HeldExit();
      exits.push(exit);
      return [exit];
    },
  });
  return {
    finish: () => {
      for (const exit of exits.splice(0)) exit.finish();
    },
    restore: () => {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    },
  };
}

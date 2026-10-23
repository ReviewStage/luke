/**
 * held-exits.ts -- an exit that runs under jsdom until the test finishes it: jsdom runs no motion, so an element leaving would be taken at once.
 *
 * Every element marked `data-leaving`, or that `exiting` names, answers
 * `getAnimations` with one running exit, as the engine would while its
 * stylesheet's exit plays; `finish` ends every exit handed out, and
 * `restore` takes the engine away.
 */

/** Whether an element is leaving: marked so, as a held disclosure is. */
function marked(element: Element): boolean {
  return element.getAttribute("data-leaving") === "true";
}

export function holdExits(exiting: (element: Element) => boolean = marked) {
  const exits: EventTarget[] = [];
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value(this: Element) {
      if (!exiting(this)) return [];
      const exit = new EventTarget();
      exits.push(exit);
      return [exit];
    },
  });
  return {
    finish: () => {
      for (const exit of exits.splice(0)) exit.dispatchEvent(new Event("finish"));
    },
    restore: () => {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    },
  };
}

function marked(element: Element): boolean {
  return (
    element.getAttribute("data-leaving") === "true" || element.hasAttribute("data-ending-style")
  );
}

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

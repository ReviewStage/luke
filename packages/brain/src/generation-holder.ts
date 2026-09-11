/**
 * Which generation stands, and the one decision that changes it. The agent
 * and the store share a generation only by its id: the store announces the
 * envelope that now stands, and this holder decides — once, synchronously —
 * whether the announcement is the generation already held or a successor to
 * install in its place. The cell is a `MutableRef`, whose read and write are
 * each a statement rather than an effect, so the decision is one
 * uninterrupted step of the caller's own turn and there is no run anywhere
 * in it: the fence a replacement raises is up before the caller's next
 * statement, so a turn holding a model answer, a read, or an action's
 * preparation is revoked before any disk is waited on, and a result landing
 * afterwards finds the generation it opened in no longer standing and
 * installs nothing. A `Ref` would say the same thing as an effect, and an
 * effect here could only be run — which is the fence's guarantee written as
 * a bridge rather than as the language.
 *
 * What the replaced generation owned is released by the caller, through
 * `retireGeneration` — inside the build where a replacement releases before
 * its successor stands, and after the queue has drained where a stop does.
 */
import { MutableRef } from "effect";
import type { Generation } from "./generation.js";

export const GENERATION_ADOPTION = {
  /** The announcement names the generation already held; nothing was built and nothing changed. */
  STANDING: "standing",
  /** A successor now stands; the generation it replaced, when one did, is the caller's to retire. */
  ADOPTED: "adopted",
} as const;

export type GenerationAdoption =
  | { kind: typeof GENERATION_ADOPTION.STANDING; generation: Generation }
  | {
      kind: typeof GENERATION_ADOPTION.ADOPTED;
      generation: Generation;
      previous: Generation | undefined;
    };

export class GenerationHolder {
  readonly #standing: MutableRef.MutableRef<Generation | undefined> = MutableRef.make<
    Generation | undefined
  >(undefined);

  /** The generation that stands, or nothing before the first is adopted. */
  standing(): Generation | undefined {
    return MutableRef.get(this.#standing);
  }

  /**
   * Installs the generation `build` makes for the id named, unless that id is
   * the one already standing, in which case nothing is built. The read, the
   * comparison, the build, and the installation are one uninterrupted step of
   * the calling turn, so two announcements cannot both read the same
   * predecessor and both install over it; `build` runs exactly once, and what
   * a replacement releases inside it is over before the successor stands.
   */
  adopt(
    generationId: string,
    build: (previous: Generation | undefined) => Generation,
  ): GenerationAdoption {
    const previous = MutableRef.get(this.#standing);
    if (previous?.id === generationId) {
      return { kind: GENERATION_ADOPTION.STANDING, generation: previous };
    }
    const generation = build(previous);
    MutableRef.set(this.#standing, generation);
    return { kind: GENERATION_ADOPTION.ADOPTED, generation, previous };
  }
}

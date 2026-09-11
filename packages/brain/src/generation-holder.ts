/**
 * Which generation stands, and the one decision that changes it. The agent
 * and the store share a generation only by its id: the store announces the
 * envelope that now stands, and this holder decides — once, synchronously —
 * whether the announcement is the generation already held or a successor to
 * install in its place. The decision is a plain `Ref`'s own `modify`, which
 * never suspends, so the fence a replacement raises is up before the caller's
 * next statement, exactly as it was when the holder was a field: a turn
 * holding a model answer, a read, or an action's preparation is revoked
 * before any disk is waited on, and a result landing afterwards finds the
 * generation it opened in no longer standing and installs nothing.
 *
 * What the replaced generation owned is released by the caller, through
 * `retireGeneration` — inside the build where a replacement releases before
 * its successor stands, and after the queue has drained where a stop does.
 */
import { Effect, Ref } from "effect";
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
  readonly #standing: Ref.Ref<Generation | undefined> = Effect.runSync(
    Ref.make<Generation | undefined>(undefined),
  );

  /** The generation that stands, or nothing before the first is adopted. */
  standing(): Generation | undefined {
    return Effect.runSync(Ref.get(this.#standing));
  }

  /**
   * Installs the generation `build` makes for the id named, unless that id is
   * the one already standing, in which case nothing is built. The comparison
   * and the installation are one `Ref.modify` decision, so two announcements
   * cannot both read the same predecessor and both install over it; the
   * callback runs exactly once and never against a value this modify then
   * discards, which is why what a replacement releases may run inside it and
   * still be over before the successor stands.
   */
  adopt(
    generationId: string,
    build: (previous: Generation | undefined) => Generation,
  ): GenerationAdoption {
    return Effect.runSync(
      Ref.modify(this.#standing, (previous): [GenerationAdoption, Generation] => {
        if (previous?.id === generationId) {
          return [{ kind: GENERATION_ADOPTION.STANDING, generation: previous }, previous];
        }
        const generation = build(previous);
        return [{ kind: GENERATION_ADOPTION.ADOPTED, generation, previous }, generation];
      }),
    );
  }
}

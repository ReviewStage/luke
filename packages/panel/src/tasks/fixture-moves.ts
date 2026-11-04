/**
 * fixture-moves.ts -- the one door a fixture run's stage moving on its own goes through, so the window stages its document again.
 *
 * A fixture run's document is main's with what its profile stages laid
 * over it (`tasks-fixture-loader.ts`'s `fixtureAppState`), staged again as
 * each delivery lands. A stage that moves with no delivery, as the long
 * run's transcript does as it is written to (`agent-long-run-fixture.ts`),
 * says so here, and the window stages the document it holds again
 * (`use-app-state.ts`). Nothing in a live run says anything here.
 */

/** Every window's ear on the stage, which a reading of its document heard. */
const listeners = new Set<() => void>();

/** Hears each move of a fixture run's stage until the returned call stops it. */
export function onFixtureMoved(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Says a fixture run's stage moved, so every window stages its document again. */
export function fixtureMoved(): void {
  for (const listener of listeners) listener();
}

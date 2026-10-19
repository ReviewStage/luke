import { Effect } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createElement, type ReactElement } from "react";
import {
  type SideBundleImporters,
  type SideBundles,
  SideBundlesContext,
  sideBundles,
} from "../bundle-loader.js";

/**
 * side-bundles.ts -- the panel's own bundles under jsdom: one landed as a window that has shown it holds it, and stand-ins for others at their importers.
 *
 * A surface reaches each bundle through its importer (`../renderer/bundle-loader.ts`).
 * A test hands its own importers, answering a stand-in or failing, and draws
 * the surface over the bundles they make with `onSideBundles`; a bundle
 * landed before the surface is drawn is had at once, as one is in a window
 * that has shown it before. A test of a surface that only draws around a
 * bundle draws it over `unlandedBundles`, so no bundle lands under it while
 * it runs.
 */

/** Imports a bundle and settles once it has landed, so every later reader has it at once. */
export function bundleLanded<A>(
  bundle: Atom.Atom<AsyncResult.AsyncResult<A, Error>>,
): Effect.Effect<A, Error> {
  return AtomRegistry.getResult(AtomRegistry.make(), bundle);
}

/** The bundles over the importers given, each given one landed already, and the rest through their own entries. */
export function landedBundles(
  importers: Partial<SideBundleImporters>,
): Effect.Effect<SideBundles, Error> {
  const bundles = sideBundles(importers);
  const given = Object.keys(importers).filter((key): key is keyof SideBundles => key in bundles);
  return Effect.forEach(given, (key) => bundleLanded<unknown>(bundles[key]), {
    discard: true,
  }).pipe(Effect.as(bundles));
}

/** The bundles as a window holds them before any has landed: each asked for, and none answering. */
export function unlandedBundles(): SideBundles {
  const unlanded = () => Promise.withResolvers<never>().promise;
  return sideBundles({
    planEditor: unlanded,
    whiteboard: unlanded,
    fileTree: unlanded,
    terminal: unlanded,
    diagram: unlanded,
    diffView: unlanded,
  });
}

/** The element drawn over the bundles given. */
export function onSideBundles(bundles: SideBundles, element: ReactElement): ReactElement {
  return createElement(SideBundlesContext, { value: bundles }, element);
}

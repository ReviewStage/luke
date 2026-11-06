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

export function bundleLanded<A>(
  bundle: Atom.Atom<AsyncResult.AsyncResult<A, Error>>,
): Effect.Effect<A, Error> {
  return AtomRegistry.getResult(AtomRegistry.make(), bundle);
}

export function landedBundles(
  importers: Partial<SideBundleImporters>,
): Effect.Effect<SideBundles, Error> {
  const bundles = sideBundles(importers);
  const given = Object.keys(importers).filter((key): key is keyof SideBundles => key in bundles);
  return Effect.forEach(given, (key) => bundleLanded<unknown>(bundles[key]), {
    discard: true,
  }).pipe(Effect.as(bundles));
}

export function unlandedBundles(): SideBundles {
  const unlanded = () => Promise.withResolvers<never>().promise;
  return sideBundles({
    descriptionEditor: unlanded,
    fileTree: unlanded,
    terminal: unlanded,
    diagram: unlanded,
    diffView: unlanded,
  });
}

export function onSideBundles(bundles: SideBundles, element: ReactElement): ReactElement {
  return createElement(SideBundlesContext, { value: bundles }, element);
}

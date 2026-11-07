import { Effect } from "effect";
import { createElement, type ReactElement } from "react";
import {
  type SideBundle,
  type SideBundleImporters,
  type SideBundles,
  SideBundlesContext,
  sideBundles,
} from "../bundle-loader.js";
import type { TerminalModule } from "../terminal/contract.js";
import { testQueryClientNow } from "./copy-feedback.js";
import { landRead } from "./landed-reads.js";

/**
 * side-bundles.ts -- the panel's own bundles under jsdom: one landed as a window that has shown it holds it, and stand-ins for others at their importers.
 *
 * A surface reaches each bundle through its importer (`../bundle-loader.ts`).
 * A test hands its own importers, answering a stand-in or failing, and draws
 * the surface over the bundles they make with `onSideBundles`; a bundle
 * landed before the surface is drawn is had at once, as one is in a window
 * that has shown it before. A test of a surface that only draws around a
 * bundle draws it over `unlandedBundles`, so no bundle lands under it while
 * it runs. A terminal tab draws over `fittedTerminalBundles`, its real
 * screen fitted at the size a window would lay it out at, since jsdom lays
 * out no box to fit a screen to.
 */

/** Reads a bundle into the test's Query client and settles once it has landed, so every later reader, and every client the file makes after, has it at once (`landed-reads.ts`); a failed import fails with its error. */
export function bundleLanded<A>(bundle: SideBundle<A>): Effect.Effect<A, Error> {
  return landRead(testQueryClientNow(), bundle);
}

/** The bundles over the importers given, each given one landed already, and the rest through their own entries. */
export function landedBundles(
  importers: Partial<SideBundleImporters>,
): Effect.Effect<SideBundles, Error> {
  const bundles = sideBundles(importers);
  const given = Object.keys(importers).filter((key): key is keyof SideBundles => key in bundles);
  const land = <Bundle extends keyof SideBundles>(key: Bundle) => bundleLanded(bundles[key]);
  return Effect.forEach(given, land, {
    discard: true,
  }).pipe(Effect.as(bundles));
}

/**
 * The bundles over the importers given, each of those read from its own
 * importer in this case however the file landed it, its landing taken out
 * of the test's client: for a case that wants a bundle unloaded, failing, or
 * a stand-in of its own, said where the case is written.
 */
export function standInBundles(importers: Partial<SideBundleImporters>): SideBundles {
  const bundles = sideBundles(importers);
  const client = testQueryClientNow();
  const given = Object.keys(importers).filter((key): key is keyof SideBundles => key in bundles);
  for (const key of given) client.removeQueries({ queryKey: bundles[key].queryKey, exact: true });
  return bundles;
}

/** The bundles as a window holds them before any has landed: each asked for, and none answering. */
export function unlandedBundles(): SideBundles {
  const unlanded = () => Promise.withResolvers<never>().promise;
  return standInBundles({
    descriptionEditor: unlanded,
    fileTree: unlanded,
    terminal: unlanded,
    diagram: unlanded,
    diffView: unlanded,
  });
}

/** The size a terminal tab's screen is laid out at here, in cells. */
export const FITTED_SIZE = { cols: 80, rows: 24 } as const;

/** The terminal bundle's own screen, said to be fitted at `FITTED_SIZE` the first time it is shown, as a window's layout would fit it. */
function fittedTerminal(terminal: TerminalModule): TerminalModule {
  return {
    create: (props) => {
      const screen = terminal.create(props);
      let fitted = false;
      return {
        ...screen,
        attach: (host) => {
          screen.attach(host);
          if (fitted) return;
          fitted = true;
          props.onResize(FITTED_SIZE);
        },
      };
    },
  };
}

/** The bundles a terminal tab draws over: the window's own, its terminal fitted as a window lays it out. */
export function fittedTerminalBundles(): Effect.Effect<SideBundles, Error> {
  return landedBundles({
    terminal: () => import("../terminal/index.js").then((entry) => fittedTerminal(entry.terminal)),
  });
}

/** The element drawn over the bundles given. */
export function onSideBundles(bundles: SideBundles, element: ReactElement): ReactElement {
  return createElement(SideBundlesContext, { value: bundles }, element);
}

/**
 * window-router.ts -- a window's router in a test, as its root mounts one: the panel's routes over a history the test holds, provided to what the test draws, and the address of every entry that history holds.
 *
 * The history is a memory one starting at `/app`, as the desktop's window
 * opens, unless the test hands the tab's own. The router's history names
 * only the entry standing, so the entries are learnt here from what it
 * tells its subscribers, as a reader outside the panel would.
 */

import {
  createMemoryHistory,
  RouterContextProvider,
  type RouterHistory,
} from "@tanstack/react-router";
import { createElement, type ReactElement } from "react";
import { createPanelRouter, PanelRouterProvider } from "../panel-router.js";
import { testQueryClientNow } from "./copy-feedback.js";

/** The router a test's window stands under. */
export interface TestWindowRouter {
  readonly history: RouterHistory;
  /** The address of every entry the history holds, oldest first. */
  readonly addresses: () => readonly string[];
  /** Where among them the history stands. */
  readonly at: () => number;
  /** `element` under the router, as the window's root draws the panel under it. */
  readonly provide: (element: ReactElement) => ReactElement;
  /** The router drawn as the window's root draws it, `App` its root route's, and whatever route stands drawn in its places. */
  readonly drawn: () => ReactElement;
}

/** The panel's router over `history`, a memory history at `/app` where none is given, its entries followed from the start. */
export function windowRouter(
  history: RouterHistory = createMemoryHistory({ initialEntries: ["/app"] }),
): TestWindowRouter {
  // Note that its routes read the test's own client, the one the window draws with, as a root hands its window's.
  const router = createPanelRouter(history, testQueryClientNow());
  let entries: readonly string[] = [history.location.href];
  let at = 0;
  const clamp = (to: number) => Math.min(Math.max(to, 0), entries.length - 1);
  history.subscribe(({ location, action }) => {
    switch (action.type) {
      case "PUSH":
        entries = [...entries.slice(0, at + 1), location.href];
        at = entries.length - 1;
        return;
      case "REPLACE":
        entries = entries.with(at, location.href);
        return;
      case "BACK":
        at = clamp(at - 1);
        return;
      case "FORWARD":
        at = clamp(at + 1);
        return;
      case "GO":
        at = clamp(at + action.index);
        return;
    }
  });
  return {
    history,
    addresses: () => entries,
    at: () => at,
    provide: (element) => createElement(RouterContextProvider, { router, children: element }),
    drawn: () => createElement(PanelRouterProvider, { router }),
  };
}

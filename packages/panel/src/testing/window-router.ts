import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  RouterContextProvider,
  type RouterHistory,
} from "@tanstack/react-router";
import { createElement, type ReactElement } from "react";
import { createPanelRouter, PanelRouterProvider } from "../panel-router.js";

export interface TestWindowRouter {
  readonly history: RouterHistory;
  readonly addresses: () => readonly string[];
  readonly at: () => number;
  readonly provide: (element: ReactElement) => ReactElement;
  readonly drawn: () => ReactElement;
}

export function windowRouter(
  history: RouterHistory = createMemoryHistory({ initialEntries: ["/app"] }),
): TestWindowRouter {
  const router = createPanelRouter(history, new QueryClient());
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

// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { IDLE_TASKS_VIEW, TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { type AppStateSnapshot, NO_ACCESS, RUN_PROFILE } from "@luke/host/app-state";
import { type AppBridge, bridgeEntries } from "@luke/host/bridge";
import { PUSH_METHOD } from "@luke/host/contract";
import { memoryHistory } from "@luke/ui/history-adapter";
import { Effect } from "effect";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach } from "vitest";
import { App } from "./app.js";
// Note that the places are loaded as the window loads them, on first use
// (`pages-on-demand.ts`), so each module is read here first and its load
// settles within the test's own ticks rather than on a clock a busy machine outruns.
import "./desktop/automations-page.js";
import "./desktop/desktop-admin.js";
import "./desktop/desktop-settings.js";
import "./desktop/person-page.js";
import { installWindowHistory } from "./navigation-history.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { loadTasksFixture } from "./tasks/tasks-fixture-loader.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { stateWith } from "./testing/app-state.js";
import { appStateFirstRead } from "./use-app-state.js";

/**
 * app-fixture-places.test.ts -- a fixture run, which main hands signed out
 * with nothing read, opens the window where its Settings, Admin, or
 * Automations profile names, signed in as the fixture's synthetic account,
 * each page drawn from the answers the fixture stages at the act door rather
 * than its signed-out line, and its person profile's account reads its own
 * page as its own; and a fixture run on any other profile still draws the
 * account main holds.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  fakeAppPlatform({
    ...QUIET_PANEL,
    applySessionReplay: () => undefined,
    adminDashboard: () => ({ href: "https://luke.test/admin" }),
  });
  installWindowHistory(memoryHistory());
  // Every act main would answer is refused, as a fixture run's service reads go empty-handed.
  fakeActPortAnswering(() => Promise.reject(refusedOnPort("Not here.")));
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  // The window's one registry holds the document it read, so the next test's window reads its own.
  rendererRegistry.reset();
});

/** Main's document for a fixture run on `profile`: signed out, nothing read, no access. */
function fixtureRun(profile: string): AppStateSnapshot {
  const { run } = stateWith({}, {});
  return stateWith(
    {},
    {
      run: { ...run, fixtureMode: true, profile },
      account: { status: ACCOUNT_STATUS.SIGNED_OUT },
      access: NO_ACCESS,
      tasks: IDLE_TASKS_VIEW,
    },
  );
}

/** Hands the window main's document for a fixture run on `profile`, every other bridge call quiet. */
function handFixtureRun(profile: string): void {
  const snapshot = fixtureRun(profile);
  const quiet = Object.fromEntries([
    ...Object.keys(PUSH_METHOD).map((method) => [method, () => () => undefined]),
    ...bridgeEntries().map(([method, entry]) => [
      method,
      entry.kind === "invoke" ? () => Promise.resolve(undefined) : () => undefined,
    ]),
  ]);
  fakeAppBridge({
    ...quiet,
    requestAppState: () => Promise.resolve(structuredClone(snapshot)),
    onAppState: () => () => undefined,
  } satisfies Partial<AppBridge>);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 48; tick += 1) await Promise.resolve();
  });
}

/**
 * Draws the window as its root does on a fixture run on `profile`: on the
 * window's one registry, once main's document is read
 * (`window-root.tsx`) and the synthetic tasks have landed (`App`).
 */
function drawWindow(profile: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    handFixtureRun(profile);
    yield* Effect.orDie(appStateFirstRead);
    yield* Effect.promise(loadTasksFixture);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() =>
      root?.render(
        createElement(RegistryContext.Provider, { value: rendererRegistry }, createElement(App)),
      ),
    );
    yield* Effect.promise(settle);
  });
}

/** The window's words as drawn. */
function drawn(): string {
  return document.body.textContent ?? "";
}

it.effect(
  "the Settings workspace profile opens Settings on Acme signed in, its members read and its Linear's sign-in expired",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.SETTINGS_WORKSPACE);

      assert.ok(document.querySelector(".desktop-settings"), "Settings stands");
      assert.match(drawn(), /Maya Okafor/u);
      assert.match(drawn(), /sam@example\.com/u);
      assert.match(drawn(), /Sign-in expired/u);
    }),
);

it.effect("the Admin profile opens Admin's Overview for the account, an admin", () =>
  Effect.gen(function* () {
    yield* drawWindow(RUN_PROFILE.ADMIN);

    assert.ok(document.querySelector('nav[aria-label="Admin sections"] .luke-nav-item'));
  }),
);

it.effect(
  "the Automations runs profile opens the automation whose run failed, its runs beside it",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.AUTOMATIONS_RUNS);

      assert.match(drawn(), /Check each deploy/u);
    }),
);

it.effect(
  "a fixture run on the tasks profile opens the Tasks tab, the account as main holds it",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.TASKS);

      assert.equal(document.querySelector(".desktop-settings"), null);
      assert.doesNotMatch(drawn(), /ada@example\.com/u);
    }),
);

it.effect(
  "a fixture run on the tasks profile lands its open task's column, a task with no agents, while main answers nothing",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.TASKS);

      const column = document.querySelector(".desktop-task-column");
      assert.ok(column, "the open task's column stands");
      assert.equal(column.querySelector('[class*="skeleton"]'), null);
      assert.ok(
        [...document.querySelectorAll('[role="tab"]')].some((tab) =>
          tab.textContent?.includes("New agent"),
        ),
        "the column opens on its New agent tab",
      );
    }),
);

it.effect(
  "a fixture run on the tasks-transcript profile draws the open task's plan with no linked issues, while main answers nothing",
  () =>
    Effect.gen(function* () {
      // Main answers a fixture run's read of the task's linked issues as one the service never answered (`compose-tasks.ts`).
      fakeActPortAnswering(({ kind }) =>
        kind === ACT_KIND.TASK_ISSUES_READ
          ? Promise.resolve({ failure: TASK_CALL_FAILURE.UNANSWERED })
          : Promise.reject(refusedOnPort("Not here.")),
      );
      yield* drawWindow(RUN_PROFILE.TASKS_TRANSCRIPT);

      const links = document.querySelector(".task-issue-links");
      assert.ok(links, "the plan's Linked issues box stands");
      assert.match(links.textContent ?? "", /Link issue/u);
      assert.doesNotMatch(drawn(), /did not answer/u);
    }),
);

it.effect(
  "the person profile's account opens its own profile from its menu and reads it as its own",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.PERSON);
      // The account's button at the sidebar's foot, named by the account alone where the workspace's switcher says more.
      const account = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.endsWith("Ada Lovelace") && !button.matches("[aria-label]"),
      );
      assert.ok(account, "the account's button stands");
      act(() => account.click());
      const profile = [...document.querySelectorAll('[role="menuitem"]')].find(
        (item): item is HTMLElement =>
          item instanceof HTMLElement &&
          item.querySelector(".luke-menu-item-label")?.textContent === "Your profile",
      );
      assert.ok(profile, "its menu offers Your profile");
      act(() => profile.click());
      yield* Effect.promise(settle);

      assert.match(drawn(), /Assigned to you/u);
      assert.match(drawn(), /Needs you/u);
      assert.doesNotMatch(drawn(), /Waiting on their answer/u);
    }),
);

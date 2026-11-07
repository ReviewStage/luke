// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import { type AppStateSnapshot, NO_ACCESS, RUN_PROFILE } from "@repo/host/app-state";
import { type AppBridge, bridgeEntries } from "@repo/host/bridge";
import { PUSH_METHOD } from "@repo/host/contract";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
// Note that the places are loaded as the window loads them, on first use
// (the router's lazy routes, and `desktop-shell.tsx`'s Automations), so each module is read here first and its load
// settles within the test's own ticks rather than on a clock a busy machine outruns.
import "./desktop/automations-page.js";
import "./desktop/admin-route.lazy.js";
import "./desktop/settings-route.lazy.js";
import "./desktop/person-route.lazy.js";
import { runAppCommand } from "./app-commands.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { loadTasksFixture } from "./tasks/tasks-fixture-loader.js";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { stateWith } from "./testing/app-state.js";
import { onRegistry, readAppState } from "./testing/copy-feedback.js";
import { windowRouter } from "./testing/window-router.js";

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
    adminDashboard: () => ({ href: "https://app.test/admin" }),
  });
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
    // The document is in the client before the window draws, as the root's `ensureQueryData` leaves it.
    yield* Effect.promise(readAppState);
    yield* Effect.promise(loadTasksFixture);
    root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root?.render(onRegistry(rendererRegistry, windowRouter().drawn())));
    yield* Effect.promise(settle);
  });
}

/** The window's words as drawn. */
function drawn(): string {
  return document.body.textContent ?? "";
}

it.effect("the Settings workspace profile opens Settings on Acme signed in, its members read", () =>
  Effect.gen(function* () {
    yield* drawWindow(RUN_PROFILE.SETTINGS_WORKSPACE);

    assert.ok(document.querySelector(".desktop-settings"), "Settings stands");
    assert.match(drawn(), /Maya Okafor/u);
    assert.match(drawn(), /sam@example\.com/u);
  }),
);

it.effect("the Admin profile opens Admin's Overview for the account, an admin", () =>
  Effect.gen(function* () {
    yield* drawWindow(RUN_PROFILE.ADMIN);

    const chosen = document.querySelector(
      '[role="radiogroup"][aria-label="Admin sections"] [aria-checked="true"]',
    );
    assert.equal(chosen?.textContent, "Overview");
  }),
);

it.effect(
  "the Automations runs profile opens the automation whose run failed, its runs beside it",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.AUTOMATIONS_RUNS);

      // Note that we wait on the automation's name itself, because its page and its read land after hops a busy runner stretches past any fixed count of ticks.
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          assert.equal(
            document.querySelector<HTMLInputElement>("input[aria-label='Automation name']")?.value,
            "Check each deploy",
          ),
        ),
      );
    }),
);

it.effect(
  "a fixture run on the tasks profile opens the Tasks tab, the account as main holds it",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.TASKS);

      assert.equal(document.querySelector(".desktop-settings") === null, true);
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
      assert.equal(column.querySelector('[class*="skeleton"]') === null, true);
      assert.equal(
        document.querySelector('.task-tabs [role="tab"]')?.getAttribute("aria-selected"),
        "true",
        "the column opens on its first tab, the task's Overview",
      );
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
          item.querySelector(".ui-menu-item-label")?.textContent === "Your profile",
      );
      assert.ok(profile, "its menu offers Your profile");
      act(() => profile.click());
      yield* Effect.promise(settle);

      assert.match(drawn(), /Assigned to you/u);
      assert.match(drawn(), /Needs you/u);
      assert.doesNotMatch(drawn(), /Waiting on their answer/u);
    }),
);

/** Types `words` into `input` as a reader does, through the prototype's setter, which React reads a change by. */
function typeInto(input: HTMLInputElement | null, words: string): void {
  assert.ok(input, "the field is drawn");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(input, words);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.effect(
  "a Settings page chosen from ⌘K over an automation's unsaved edit asks first, and Settings waits on the answer",
  () =>
    Effect.gen(function* () {
      yield* drawWindow(RUN_PROFILE.AUTOMATIONS_EDITOR);
      typeInto(document.querySelector("input[aria-label='Automation name']"), "Sweep anew");
      act(() => {
        assert.ok(runAppCommand(APP_COMMAND.COMMAND_PALETTE), "⌘K is offered");
      });
      typeInto(document.querySelector('[role="dialog"] input[role="combobox"]'), "appearance");
      const field = document.querySelector('[role="dialog"] input[role="combobox"]');
      act(() => {
        field?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
      });
      yield* Effect.promise(settle);

      assert.match(drawn(), /Leave with unsaved changes\?/u);
      assert.equal(document.querySelector(".desktop-settings"), null, "Settings waits on the ask");
    }),
);

// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import {
  DEFAULT_PLAN_TEMPLATE,
  type PlanTemplateRevisionLine,
} from "@sidecar/hosted/plan-document-template";
import { PLAN_ACTOR } from "@sidecar/hosted/plan-wire";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach } from "vitest";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "#shared/messages/acts";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { navigationHistory } from "#testing/navigation-history";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { newestToastAction, newestToastSays } from "#testing/toast";
import { runAppCommand } from "../app-commands";
import { useSidebarCollapse } from "../desktop/sidebar-collapse";
import { ToastHost } from "../toast";
import { TemplateVersionHistory } from "./plan-template-history";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const DAY = 86_400_000;

/** The developer reading the history, as their account names them. */
const READER: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dean@luke.test",
  name: "Dean",
  pictureUrl: "https://avatars.githubusercontent.com/u/1",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

const OWN = "## Why\n\nWhat prompted it.\n";
const OWN_AGAIN = "## Why\n\nWhat prompted it, and who asked.\n";

/** The template's text at each revision, by its number. */
const TEXT_AT = new Map<number, string>([
  [1, DEFAULT_PLAN_TEMPLATE],
  [2, OWN],
  [3, DEFAULT_PLAN_TEMPLATE],
  [4, OWN_AGAIN],
]);

/** A revision as the service lists it, the developer's a day apart from one another. */
function line(
  seq: number,
  extra: Partial<PlanTemplateRevisionLine> = {},
): PlanTemplateRevisionLine {
  const at = seq * DAY;
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at, duringCall: false },
    startedAt: at,
    changes: 1,
    ...extra,
  };
}

/** The template's history, newest first: an edit, a reset, an edit, and the default it began as. */
const REVISIONS: readonly PlanTemplateRevisionLine[] = [
  line(4),
  line(3, { changes: 12, default: true }),
  line(2, { changes: 12 }),
  line(1, {
    lastEdit: { actor: PLAN_ACTOR.EARLIER, at: DAY, duringCall: false },
    changes: 0,
    default: true,
  }),
];

/** Every act the history sent, in order. */
let sent: Act[] = [];

/** A done outcome carrying one kind's own answer. */
const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

/** The bridge, answering the history's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.PLAN_TEMPLATE_REVISIONS:
      return Promise.resolve(done({ revisions: [...REVISIONS] }));
    case ACT_KIND.PLAN_TEMPLATE_REVISION: {
      const { seq } = request.payload;
      const before = TEXT_AT.get(seq - 1);
      return Promise.resolve(
        done({
          revision: {
            seq,
            document: { body: TEXT_AT.get(seq) ?? "", assumptions: [] },
            previous: before === undefined ? null : { body: before, assumptions: [] },
          },
        }),
      );
    }
    case ACT_KIND.PLAN_TEMPLATE_RESTORE:
      return Promise.resolve(
        done({ template: TEXT_AT.get(request.payload.seq) ?? "", custom: true }),
      );
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

let root: Root | undefined;

/** How many times the history left for the template page. */
let exits = 0;

/** How many times the window's own history went back, which would leave Settings. */
let windowBacks = 0;

beforeEach(() => {
  sent = [];
  exits = 0;
  windowBacks = 0;
  installScrollIntoView();
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** The template's version history over the window beside the window's toasts, its minute on the test's clock. */
function mount(registry: AtomRegistry) {
  function Window() {
    const sidebar = useSidebarCollapse(false);
    return createElement(
      Fragment,
      null,
      createElement(TemplateVersionHistory, {
        sidebar,
        history: navigationHistory({
          canGoBack: true,
          onBack: () => {
            windowBacks += 1;
          },
        }),
        account: READER,
        onExit: () => {
          exits += 1;
        },
      }),
      createElement(ToastHost),
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  return Effect.as(
    Effect.promise(() =>
      act(async () => root?.render(onRegistry(registry, createElement(Window)))),
    ),
    container,
  );
}

const settled = Effect.promise(() =>
  act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
  }),
);

/** Each row of the history as who wrote it and what it did. */
function rows(page: HTMLElement): string[][] {
  return [...page.querySelectorAll(".version-row")].map((row) => [
    row.querySelector(".version-row-author")?.textContent ?? "",
    row.querySelector(".version-row-summary")?.textContent ?? "",
  ]);
}

/** Presses the button whose words are given, and lets what it asked land. */
function press(scope: ParentNode, words: string) {
  const button = [...scope.querySelectorAll("button")].find((each) => each.textContent === words);
  assert.ok(button, `no button reads "${words}"`);
  return Effect.promise(() => act(async () => button.click()));
}

/** The acts that restored a revision, by its number. */
const restores = () =>
  sent.flatMap((request) =>
    request.kind === ACT_KIND.PLAN_TEMPLATE_RESTORE ? [request.payload.seq] : [],
  );

it.effect(
  "the template's versions are listed as a plan's are, the developer's under their picture as You, a reset and the default it began as saying so, and the newest drawn beside them under the page's title",
  () =>
    Effect.gen(function* () {
      const registry = yield* registryOnTestClock;
      const page = yield* mount(registry);
      yield* settled;

      assert.equal(page.querySelector(".version-log-title")?.textContent, "Version history");
      assert.deepEqual(rows(page), [
        ["You", "1 change"],
        ["You", "Reset to the default"],
        ["You", "12 changes"],
        ["Earlier", "The default template"],
      ]);
      assert.equal(
        page.querySelector<HTMLImageElement>(".version-row img")?.src,
        READER.status === ACCOUNT_STATUS.SIGNED_IN ? READER.pictureUrl : undefined,
      );
      const version = page.querySelector<HTMLElement>(".version-page");
      assert.equal(version?.querySelector(".plan-title")?.textContent, "Plan template");
      assert.match(version?.textContent ?? "", /who asked/u, "the newest is drawn beside the list");
      assert.ok(
        version?.querySelector(".version-removed"),
        "drawn against the reset before it, the default's sections struck",
      );
      assert.deepEqual(
        sent.map((request) => request.kind),
        [ACT_KIND.PLAN_TEMPLATE_REVISIONS, ACT_KIND.PLAN_TEMPLATE_REVISION],
      );
    }),
);

it.effect(
  "restoring a version asks first, puts it back as the template, and leaves for the template with an Undo that restores the version before it",
  () =>
    Effect.gen(function* () {
      const registry = yield* registryOnTestClock;
      const page = yield* mount(registry);
      yield* settled;

      const older = [...page.querySelectorAll<HTMLButtonElement>(".version-row")][2];
      assert.ok(older);
      yield* Effect.promise(() => act(async () => older.click()));
      yield* settled;
      yield* press(page, "Restore this version");
      const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
      assert.ok(dialog, "the restore asks first");
      assert.match(dialog.textContent ?? "", /The template will go back to the version from/u);
      yield* press(dialog, "Restore");
      yield* settled;

      assert.deepEqual(restores(), [2]);
      assert.equal(exits, 1, "a restore that lands leaves for the template");
      assert.match(newestToastSays() ?? "", /^Version restored/u);
      const undo = newestToastAction();
      assert.equal(undo?.textContent, "Undo");
      yield* Effect.promise(() => act(async () => undo?.click()));
      yield* settled;
      assert.deepEqual(restores(), [2, 4]);
    }),
);

it.effect("Back leaves for the template, restoring nothing", () =>
  Effect.gen(function* () {
    const registry = yield* registryOnTestClock;
    const page = yield* mount(registry);
    yield* settled;
    const back = page.querySelector<HTMLButtonElement>(".version-log-back");
    yield* Effect.promise(() => act(async () => back?.click()));

    assert.equal(exits, 1);
    assert.deepEqual(restores(), []);
  }),
);

it.effect(
  "the window's Back, from the arrow at the list's head, its chord, or the mouse's back button, goes to the template rather than out of Settings",
  () =>
    Effect.gen(function* () {
      const registry = yield* registryOnTestClock;
      const page = yield* mount(registry);
      yield* settled;
      const arrow = page.querySelector<HTMLButtonElement>(
        '.title-bar-controls [aria-label="Back"]',
      );
      assert.ok(arrow);
      assert.equal(arrow.disabled, false);

      yield* Effect.promise(() => act(async () => arrow.click()));
      yield* Effect.promise(() =>
        act(async () => {
          runAppCommand(APP_COMMAND.BACK);
        }),
      );
      // The mouse's back button, which the window's own history hears on the window too.
      const heard: number[] = [];
      const hear = (event: MouseEvent) => heard.push(event.button);
      window.addEventListener("mouseup", hear);
      yield* Effect.promise(() =>
        act(async () => {
          document.body.dispatchEvent(new MouseEvent("mouseup", { button: 3, bubbles: true }));
        }),
      );
      window.removeEventListener("mouseup", hear);

      assert.equal(exits, 3);
      assert.equal(windowBacks, 0);
      assert.deepEqual(heard, [], "the window's history never hears the press");
    }),
);

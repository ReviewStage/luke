// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { PLAN_ACTOR, type PlanDocument, type PlanRevisionLine } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { HistoryTab } from "./history-tab";
import { type PlanHistorySource, usePlanHistory } from "./use-plan-history";
import { VersionView } from "./version-view";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const HOUR = 3_600_000;

/** The instant the test clock stands at, which the rows count back from. */
const NOW = 0;

/** A plan's document with the body's sections given after its title. */
function documentOf(
  sections: readonly string[],
  assumptions: readonly string[] = [],
): PlanDocument {
  return {
    body: ["# Teammate invitations", ...sections].join("\n\n"),
    assumptions: assumptions.map((text) => ({ text })),
  };
}

/** The plan's three versions, oldest first: Luke's first draft, an agent's, and Luke's again on a call. */
const FIRST = documentOf(["## Goal\n\nOnly admins can invite."], ["Invites reuse memberships."]);
const LATEST = documentOf(
  ["## Goal\n\nAny member can invite.", "## Decisions\n\nInvites expire."],
  ["Invites create memberships."],
);
const VERSIONS = [
  FIRST,
  documentOf(["## Goal\n\nAny member can invite."], ["Invites reuse memberships."]),
  LATEST,
] as const;

/** The plan's service, holding its history and its document, which a restore puts a version back into. */
function fakeService(now = NOW) {
  const lines: PlanRevisionLine[] = [
    {
      seq: 3,
      lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: now - 2 * HOUR, duringCall: true },
      startedAt: now - 3 * HOUR,
      changes: 2,
    },
    {
      seq: 2,
      lastEdit: {
        actor: PLAN_ACTOR.AGENT,
        label: "Invite emails",
        at: now - 5 * HOUR,
        duringCall: false,
      },
      startedAt: now - 5 * HOUR,
      changes: 1,
    },
    {
      seq: 1,
      lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: now - 26 * HOUR, duringCall: false },
      startedAt: now - 26 * HOUR,
      changes: 4,
    },
  ];
  const unreachable = (): Promise<never> => Promise.reject(new Error("Main refused the act."));
  /** The Undo each restore offered, in order. */
  const undos: (() => Promise<boolean>)[] = [];
  const service = {
    current: LATEST,
    refusing: false,
    /** Whether main refuses every read, as an act it could not carry. */
    unreachable: false,
    undos,
  };
  const source: PlanHistorySource = {
    readPage: () => (service.unreachable ? unreachable() : Promise.resolve({ revisions: lines })),
    readRevision: (_planId, seq) => {
      if (service.unreachable) return unreachable();
      const document = VERSIONS[seq - 1];
      return Promise.resolve(
        document === undefined
          ? { failure: PLAN_CALL_FAILURE.UNANSWERED }
          : { revision: { seq, document, previous: VERSIONS[seq - 2] ?? null } },
      );
    },
    restore: (_planId, seq) => {
      const document = VERSIONS[seq - 1];
      if (service.refusing || document === undefined) return Promise.resolve(false);
      service.current = document;
      return Promise.resolve(true);
    },
  };
  return Object.assign(service, { source });
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** The History tab beside the document area, as the plan's page draws them, over the service given, its minute on the test's clock. */
function mount(service: ReturnType<typeof fakeService>, registry: AtomRegistry) {
  function Page() {
    const history = usePlanHistory({
      source: service.source,
      planId: PLAN_ID,
      editedAt: undefined,
      name: "Teammate invitations",
      shown: true,
      onRestored: (undo) => {
        if (undo !== undefined) service.undos.push(undo);
      },
    });
    return createElement(
      Fragment,
      null,
      createElement("aside", null, createElement(HistoryTab, { history })),
      createElement(
        "main",
        null,
        history.viewing === undefined
          ? createElement("p", { className: "plan-as-it-stands" }, "The plan as it stands")
          : createElement(VersionView, {
              history,
              viewing: history.viewing,
              current: service.current,
              shown: true,
            }),
      ),
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  return Effect.as(
    Effect.promise(() => act(async () => root?.render(onRegistry(registry, createElement(Page))))),
    container,
  );
}

/** Each row of the History tab as its words read. */
function rows(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".history-row")].map((row) =>
    [...row.querySelectorAll("span, time")]
      .filter((part) => part.children.length === 0)
      .map((part) => part.textContent)
      .join(" · "),
  );
}

/** Presses the button whose words are given, and lets what it asked land. */
function press(scope: ParentNode, words: string) {
  const button = [...scope.querySelectorAll("button")].find((each) => each.textContent === words);
  assert.ok(
    button,
    `no button reads "${words}" among ${[...scope.querySelectorAll("button")].map((each) => each.textContent).join(" / ")}`,
  );
  return Effect.promise(() => act(async () => button.click()));
}

/** The words marked in the version as one kind of change. */
function marked(page: HTMLElement, selector: string): string[] {
  return [...page.querySelectorAll(`.version-document ${selector}`)].map(
    (mark) => mark.textContent ?? "",
  );
}

it.effect(
  "the History tab lists each version newest first: who wrote it, on a call, what it did, and when, the newest the current one",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      assert.deepEqual(rows(page), [
        "Luke · During a call · Current · 2h · 2 changes",
        "Invite emails · 5h · 1 change",
        "Luke · 1d · 4 changes",
      ]);
    }),
);

it.effect(
  "a version chosen is drawn in the document's place with what it changed marked, compared with the plan on asking, until Back to current",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      yield* press(page, "Invite emails5h1 change");
      assert.equal(page.querySelector(".plan-as-it-stands"), null);
      assert.equal(
        page.querySelector(".version-bar-title")?.textContent,
        "Viewing version from 5h ago · Invite emails",
      );
      assert.equal(
        page.querySelector('.history-row[aria-current="true"] .history-row-author')?.textContent,
        "Invite emails",
      );
      assert.deepEqual(marked(page, "del"), ["Only admins"]);
      assert.deepEqual(marked(page, "ins"), ["Any member"]);

      yield* press(page, "Compared with current");
      assert.deepEqual(marked(page, "del"), []);
      assert.deepEqual(
        [...page.querySelectorAll(".version-document .version-removed")].map(
          (unit) => unit.textContent,
        ),
        ["Decisions\nInvites expire.", "Invites create memberships."],
      );

      yield* press(page, "Back to current");
      assert.ok(page.querySelector(".plan-as-it-stands"));
      assert.equal(page.querySelector('.history-row[aria-current="true"]'), null);
    }),
);

it.effect(
  "Restore this version asks first, puts the version back once answered, and a refusal stays on the version saying why",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const page = yield* mount(service, yield* registryOnTestClock);
      yield* press(page, "Luke1d4 changes");

      service.refusing = true;
      yield* press(page, "Restore this version");
      const dialog = document.querySelector('[role="alertdialog"]');
      assert.ok(dialog);
      assert.equal(dialog.querySelector("h2")?.textContent, "Restore this version?");
      yield* press(dialog, "Restore");
      assert.equal(
        document.querySelector(".confirm-dialog-error")?.textContent,
        "The version could not be restored. Try again.",
      );
      assert.equal(service.current, LATEST);

      service.refusing = false;
      yield* press(document, "Restore");
      assert.equal(document.querySelector('[role="alertdialog"]'), null);
      assert.equal(service.current, FIRST);
      assert.ok(page.querySelector(".plan-as-it-stands"), "back to the plan as it stands");
    }),
);

it.effect("the newest version is the plan as it stands, so it offers no restore", () =>
  Effect.gen(function* () {
    const page = yield* mount(fakeService(), yield* registryOnTestClock);

    yield* press(page, "LukeDuring a callCurrent2h2 changes");

    const restore = [...page.querySelectorAll("button")].find(
      (button) => button.textContent === "Restore this version",
    );
    assert.equal(restore?.disabled, true);
    assert.match(page.querySelector(".version-bar-title")?.textContent ?? "", /Current version$/u);
  }),
);

it.effect(
  "a read main refused offers to read again rather than reading forever, and a version whose read failed is read again when chosen again",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      service.unreachable = true;
      const page = yield* mount(service, yield* registryOnTestClock);
      assert.equal(
        page.querySelector(".side-panel-empty p")?.textContent,
        "The history could not be read.",
      );

      service.unreachable = false;
      yield* press(page, "Try again");
      assert.equal(rows(page).length, 3);

      service.unreachable = true;
      yield* press(page, "Luke1d4 changes");
      assert.equal(
        page.querySelector(".version-note")?.textContent,
        "The version could not be read.",
      );
      service.unreachable = false;
      yield* press(page, "Luke1d4 changes");
      assert.deepEqual(marked(page, "del"), []);
      assert.equal(
        page.querySelector(".version-note")?.textContent,
        "The first version: there is nothing before it to compare.",
      );
    }),
);

it.effect("a restore offers to undo it, which puts back the version that stood before it", () =>
  Effect.gen(function* () {
    const service = fakeService();
    const page = yield* mount(service, yield* registryOnTestClock);
    yield* press(page, "Luke1d4 changes");
    yield* press(page, "Restore this version");
    yield* press(document, "Restore");
    assert.equal(service.current, FIRST);

    const undone = yield* Effect.promise(() => service.undos.at(-1)?.() ?? Promise.resolve(false));

    assert.ok(undone);
    assert.equal(service.current, LATEST);
  }),
);

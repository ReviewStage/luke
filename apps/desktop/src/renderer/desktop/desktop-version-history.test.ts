// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  PLAN_ACTOR,
  type Plan,
  type PlanDocument,
  type PlanRevisionLine,
} from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
import { Effect } from "effect";
import type { AtomRegistry } from "effect/unstable/reactivity/AtomRegistry";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach } from "vitest";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { navigationHistory } from "#testing/navigation-history";
import { plansControl } from "#testing/plans-control";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { type PlanHistorySource, usePlanHistory } from "../planning/use-plan-history";
import { DesktopVersionHistory } from "./desktop-version-history";
import { useSidebarCollapse } from "./sidebar-collapse";

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

/** The plan as the window draws it, its document as the service holds it now. */
function planOf(document: PlanDocument): Plan {
  return {
    id: PLAN_ID,
    name: "Teammate invitations",
    createdAt: 0,
    updatedAt: 0,
    repository: null,
    document,
  };
}

/**
 * The plan's version history over the window, as the shell draws it, over the
 * service given, its minute on the test's clock; leaving it draws the plan in
 * its place.
 */
function mount(service: ReturnType<typeof fakeService>, registry: AtomRegistry) {
  function Window() {
    const sidebar = useSidebarCollapse(false);
    const [open, setOpen] = useState(true);
    const history = usePlanHistory({
      source: service.source,
      planId: PLAN_ID,
      editedAt: undefined,
      name: "Teammate invitations",
      shown: open,
      onRestored: (undo) => {
        if (undo !== undefined) service.undos.push(undo);
      },
    });
    if (!open) return createElement("p", { className: "plan-as-it-stands" }, "The plan");
    const plans = plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN_ID,
      region: { kind: DOCUMENT_REGION.READY, plan: planOf(service.current) },
      history: { ...history, open, onOpen: () => setOpen(true), onClose: () => setOpen(false) },
    });
    return createElement(DesktopVersionHistory, {
      sidebar,
      history: navigationHistory(),
      plans,
      onExit: () => setOpen(false),
    });
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

/** Each row of the version history as its words read. */
function rows(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".version-row")].map((row) =>
    [...row.querySelectorAll("span, time")]
      .filter((part) => part.children.length === 0)
      .map((part) => part.textContent)
      .join(" · "),
  );
}

/** Who wrote the version whose row is lit. */
function chosen(page: HTMLElement): string | null | undefined {
  return page.querySelector('.version-row[aria-current="true"] .version-row-author')?.textContent;
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

/** An arrow pressed wherever focus stands, and what it asked let land. */
function arrow(
  key: "ArrowUp" | "ArrowDown",
  target: EventTarget = document.activeElement ?? document.body,
) {
  return Effect.promise(() =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }),
  );
}

/** The words marked in the version drawn as one kind of change. */
function marked(page: HTMLElement, selector: string): string[] {
  return [...page.querySelectorAll(`.version-page ${selector}`)].map(
    (mark) => mark.textContent ?? "",
  );
}

/** The version page's Restore this version. */
function restoreButton(page: HTMLElement): HTMLButtonElement | undefined {
  return [...page.querySelectorAll<HTMLButtonElement>(".version-page button")].find(
    (button) => button.textContent === "Restore this version",
  );
}

it.effect(
  "the version history lists each version newest first: who wrote it, whether on a call, what it did, and when, under the plan's name",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      assert.equal(page.querySelector(".version-log-title")?.textContent, "Version history");
      assert.equal(page.querySelector(".version-log-plan")?.textContent, "Teammate invitations");
      assert.deepEqual(rows(page), [
        "Luke · Current · During a call · 2h · 2 changes",
        "Invite emails · 5h · 1 change",
        "Luke · 1d · 4 changes",
      ]);
      assert.ok(page.querySelector("nav.version-log.ph-no-capture"));
      assert.ok(page.querySelector("section.version-page.ph-no-capture"));
    }),
);

it.effect(
  "it opens on the plan as it stands, with what its last revision changed marked and nothing to restore",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      assert.equal(chosen(page), "Luke");
      assert.equal(page.querySelector(".version-page .version-tag")?.textContent, "Current");
      assert.equal(restoreButton(page)?.disabled, true);
      assert.deepEqual(marked(page, ".version-added"), [
        "Decisions\nInvites expire.",
        "Invites create memberships.",
      ]);
    }),
);

it.effect(
  "a version chosen is drawn beside the list with what it changed from the one before it marked, the Current row as any other",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      yield* press(page, "Invite emails5h1 change");
      assert.equal(chosen(page), "Invite emails");
      assert.equal(page.querySelector(".version-page .version-tag"), null);
      assert.equal(restoreButton(page)?.disabled, false);
      assert.deepEqual(marked(page, "del"), ["Only admins"]);
      assert.deepEqual(marked(page, "ins"), ["Any member"]);
      assert.equal(page.querySelector("[aria-label='Compare']"), null, "no other comparison");

      yield* press(page, "LukeCurrentDuring a call2h2 changes");
      assert.equal(chosen(page), "Luke");
      assert.deepEqual(marked(page, "del"), []);
      assert.deepEqual(marked(page, ".version-added"), [
        "Decisions\nInvites expire.",
        "Invites create memberships.",
      ]);
    }),
);

it.effect(
  "the up and down arrows step through the versions and focus the row chosen, stopping at either end",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      yield* arrow("ArrowDown");
      assert.equal(chosen(page), "Invite emails");
      assert.equal(document.activeElement, page.querySelector('.version-row[aria-current="true"]'));
      yield* arrow("ArrowDown");
      yield* arrow("ArrowDown");
      assert.deepEqual(marked(page, "del"), [], "the first version, past which there is none");
      assert.equal(
        page.querySelector(".version-note")?.textContent,
        "The first version: there is nothing before it to compare.",
      );

      yield* arrow("ArrowUp");
      yield* arrow("ArrowUp");
      yield* arrow("ArrowUp");
      assert.equal(chosen(page), "Luke");
      assert.equal(page.querySelector(".version-page .version-tag")?.textContent, "Current");
    }),
);

it.effect(
  "Restore this version asks first, puts the version back once answered and leaves for the plan, and a refusal stays on the version saying why",
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
      assert.ok(page.querySelector(".plan-as-it-stands"), "back to the plan");
    }),
);

it.effect("Back leaves the version history for the plan", () =>
  Effect.gen(function* () {
    const page = yield* mount(fakeService(), yield* registryOnTestClock);
    const back = page.querySelector<HTMLButtonElement>("button.version-log-back");

    assert.equal(back?.getAttribute("aria-keyshortcuts"), "Escape");
    yield* press(page, "BackEsc");
    assert.ok(page.querySelector(".plan-as-it-stands"));
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
        page.querySelector(".version-page [role='alert']")?.textContent,
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

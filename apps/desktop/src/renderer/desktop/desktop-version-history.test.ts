// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountSnapshot,
} from "@sidecar/credentials/snapshot";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
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
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry, registryOnTestClock } from "#testing/copy-feedback";
import { ringClipping, sheetStyle } from "#testing/css-rules";
import { navigationHistory } from "#testing/navigation-history";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { runAppCommand } from "../app-commands";
import { REVISION_SOURCE, type RevisionSource } from "../planning/plan-history-model";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { type PlanHistorySource, usePlanHistory } from "../planning/use-plan-history";
import { DesktopVersionHistory, planVersionSubject } from "./desktop-version-history";
import { useSidebarCollapse } from "./sidebar-collapse";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const HOUR = 3_600_000;

/** The developer reading the history, as their account names them. */
const READER: AccountSnapshot = {
  status: ACCOUNT_STATUS.SIGNED_IN,
  email: "dean@luke.test",
  name: "Dean",
  pictureUrl: "https://avatars.githubusercontent.com/u/1",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

/** The plan's coding agent that wrote its second version, on a model Claude Code runs. */
const INVITE_AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: PLAN_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite emails",
  createdAt: 0,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

/** The instant the test clock stands at, which the rows count back from. */
const NOW = 0;

/** A plan's document as the service answers one: its text of these sections, its assumptions among them. */
function documentOf(sections: readonly string[]): PlanDocument {
  return { body: `${sections.join("\n\n")}\n`, assumptions: [] };
}

/** The plan's three versions, oldest first: Luke's first draft, an agent's, and Luke's again on a call. */
const FIRST = documentOf([
  "## Goal\n\nOnly admins can invite.",
  "## Assumptions\n\n- Invites reuse memberships.",
]);
const LATEST = documentOf([
  "## Goal\n\nAny member can invite.",
  "## Decisions\n\nInvites expire.",
  "## Assumptions\n\n- Invites create memberships.",
]);
const VERSIONS: readonly PlanDocument[] = [
  FIRST,
  documentOf([
    "## Goal\n\nAny member can invite.",
    "## Assumptions\n\n- Invites reuse memberships.",
  ]),
  LATEST,
];

/**
 * The plan's service, holding its history and its document, which a restore
 * puts a version back into: `versions` oldest first.
 */
function fakeService(now = NOW, versions: readonly PlanDocument[] = VERSIONS) {
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
      agentId: INVITE_AGENT.id,
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
  /** The answers held back while `holding`, in order. */
  const held: (() => void)[] = [];
  const service = {
    current: versions.at(-1) ?? LATEST,
    refusing: false,
    /** Whether main refuses every read, as an act it could not carry. */
    unreachable: false,
    /** Whether a read waits for `release` before it is answered. */
    holding: false,
    held,
    undos,
  };
  const answer = <A>(read: () => Promise<A>): Promise<A> =>
    service.holding ? new Promise((land) => service.held.push(() => land(read()))) : read();
  const source: PlanHistorySource = {
    readPage: () =>
      answer(() => (service.unreachable ? unreachable() : Promise.resolve({ revisions: lines }))),
    readRevision: (_planId, seq) =>
      answer(() => {
        if (service.unreachable) return unreachable();
        const document = versions[seq - 1];
        return Promise.resolve(
          document === undefined
            ? { failure: PLAN_CALL_FAILURE.UNANSWERED }
            : { revision: { seq, document, previous: versions[seq - 2] ?? null } },
        );
      }),
    restore: (_planId, seq) => {
      const document = versions[seq - 1];
      if (service.refusing || document === undefined) return Promise.resolve(false);
      service.current = document;
      return Promise.resolve(true);
    },
  };
  return Object.assign(service, { source, lines });
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  shownSources.length = 0;
  delete document.documentElement.dataset.keyboard;
});

/** Archives the plan the mounted window draws, as another window or Mac would. */
let archive: (() => void) | undefined;

/** Says the plan was saved at the moment given, as main does once a save lands, which reads the history again. */
let saved: ((at: number) => void) | undefined;

/** Each place a version's Open asked the window for, in order, with the plan it was asked about. */
const shownSources: { planId: string; source: RevisionSource }[] = [];

/** The plan as the window draws it, its document as the service holds it now, archived where asked. */
function planOf(document: PlanDocument, archived: boolean): Plan {
  return {
    id: PLAN_ID,
    name: "Teammate invitations",
    createdAt: 0,
    updatedAt: 0,
    repository: null,
    document,
    ...(archived ? { archivedAt: 0 } : undefined),
  };
}

/**
 * The plan's version history over the window, as the shell draws it, over the
 * service given, its minute on the test's clock, opened on the plan as it
 * stands or on the revision of the save `seek` names; leaving it draws the
 * plan in its place.
 */
function mount(
  service: ReturnType<typeof fakeService>,
  registry: AtomRegistry,
  archived = false,
  seek: number | undefined = undefined,
) {
  function Window() {
    const sidebar = useSidebarCollapse(false);
    const [open, setOpen] = useState(true);
    const [archivedNow, setArchivedNow] = useState(archived);
    archive = () => setArchivedNow(true);
    const [editedAt, setEditedAt] = useState<number | undefined>(undefined);
    saved = setEditedAt;
    const history = usePlanHistory({
      source: service.source,
      planId: PLAN_ID,
      editedAt,
      name: "Teammate invitations",
      shown: open,
      seek,
      returnTo: undefined,
      onRestored: (undo) => {
        if (undo !== undefined) service.undos.push(undo);
      },
    });
    if (!open) return createElement("p", { className: "plan-as-it-stands" }, "The plan");
    const plans = plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN_ID,
      region: {
        kind: DOCUMENT_REGION.READY,
        plan: planOf(service.current, archivedNow),
      },
      history: {
        ...history,
        open,
        onOpen: () => setOpen(true),
        onReturn: () => setOpen(true),
        onClose: () => setOpen(false),
      },
      agents: codingAgentsControl({ agents: [INVITE_AGENT] }),
      onShowSource: (planId, source) => shownSources.push({ planId, source }),
    });
    return createElement(DesktopVersionHistory, {
      sidebar,
      history: navigationHistory(),
      subject: planVersionSubject(plans),
      account: READER,
      onExit: () => setOpen(false),
      onRestored: () => setOpen(false),
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

/** Each row of the version history as its words read, its writer's mark left to the eye. */
function rows(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".version-row")].map((row) =>
    [...row.querySelectorAll("span, time")]
      .filter((part) => part.children.length === 0 && part.closest('[aria-hidden="true"]') === null)
      .map((part) => part.textContent)
      .join(" · "),
  );
}

/** What the version whose row is lit did. */
function chosenSummary(page: HTMLElement): string | null | undefined {
  return page.querySelector('.version-row[aria-current="true"] .version-row-summary')?.textContent;
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
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  target: EventTarget = document.activeElement ?? document.body,
) {
  return Effect.promise(() =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }),
  );
}

/** Answers every read held back, and every read those answers ask for, and lets them land. */
function release(service: ReturnType<typeof fakeService>) {
  service.holding = false;
  return Effect.promise(() =>
    act(async () => {
      for (const land of service.held.splice(0)) land();
    }),
  );
}

/** What a loading region in one part of the view says to a reader, and how many blocks it draws. */
function skeleton(page: HTMLElement, part: string): { says: string; blocks: number } | undefined {
  const region = page.querySelector(`${part} [role="status"][aria-busy="true"]`);
  if (region === null) return undefined;
  return {
    says: region.querySelector(".visually-hidden")?.textContent ?? "",
    blocks: region.querySelectorAll('.skeleton[aria-hidden="true"]').length,
  };
}

/** The words of the version drawn. */
function body(page: HTMLElement): string | null | undefined {
  return page.querySelector(".version-page .plan-body")?.textContent;
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

/** Whether Restore this version is announced as unavailable. */
function restoreUnavailable(page: HTMLElement): boolean {
  return restoreButton(page)?.getAttribute("aria-disabled") === "true";
}

/** The hint standing over the window, if any. */
function hint(): string | null | undefined {
  return document.body.querySelector('[role="tooltip"]')?.textContent;
}

it.effect(
  "the version history lists each version newest first under its title alone: who wrote it, what it did, and when",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      assert.equal(page.querySelector(".version-log-title")?.textContent, "Version history");
      assert.equal(
        page.querySelector(".version-log")?.textContent?.includes("Teammate invitations"),
        false,
        "no line under the title",
      );
      assert.deepEqual(rows(page), [
        "Luke · 2h · 2 changes",
        "Invite emails · 5h · 1 change",
        "Luke · 1d · 4 changes",
      ]);
      assert.ok(page.querySelector("nav.version-log.ph-no-capture"));
      assert.ok(page.querySelector("section.version-page.ph-no-capture"));
    }),
);

it.effect(
  "each version is drawn under its writer as the rest of the window draws them: Luke's face, the agent's harness, and the reader's own picture as You",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const oldest = service.lines[2];
      assert.ok(oldest);
      service.lines[2] = {
        ...oldest,
        lastEdit: { ...oldest.lastEdit, actor: PLAN_ACTOR.DEVELOPER },
      };
      const page = yield* mount(service, yield* registryOnTestClock);

      const drawn = [...page.querySelectorAll(".version-row")].map((row) => ({
        author: row.querySelector(".version-row-author")?.textContent,
        luke: row.querySelector(".version-row-mark .luke-face") !== null,
        harness: row.querySelector(".version-row-mark .provider-mark")?.tagName.toLowerCase(),
        picture: row.querySelector(".version-row-mark img")?.getAttribute("src"),
      }));
      assert.deepEqual(drawn, [
        { author: "Luke", luke: true, harness: undefined, picture: undefined },
        { author: "Invite emails", luke: false, harness: "svg", picture: undefined },
        { author: "You", luke: false, harness: undefined, picture: READER.pictureUrl },
      ]);
      assert.equal(
        page.querySelector(".version-log")?.textContent?.includes("During a call"),
        false,
      );
    }),
);

it.effect(
  "it opens on the plan as it stands under its name, with what its last revision changed marked by section and nothing to restore",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      assert.equal(chosen(page), "Luke");
      assert.equal(
        page.querySelector(".version-page .plan-body > .plan-title")?.textContent,
        "Teammate invitations",
      );
      assert.equal(page.querySelector(".version-page .version-tag"), null);
      assert.equal(restoreUnavailable(page), true);
      assert.deepEqual(marked(page, ".version-added"), ["Decisions\nInvites expire."]);
      assert.deepEqual(marked(page, "del"), ["reuse"]);
      assert.deepEqual(marked(page, "ins"), ["create"]);
    }),
);

it.effect(
  "while the versions are read the list and the page stand as quiet blocks in their shapes, and so does a version chosen while it is read",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      service.holding = true;
      const page = yield* mount(service, yield* registryOnTestClock);

      assert.deepEqual(rows(page), []);
      assert.deepEqual(skeleton(page, ".version-log"), {
        says: "Reading the versions…",
        blocks: 8,
      });
      assert.equal(skeleton(page, ".version-page")?.says, "Reading the version…");
      yield* release(service);
      assert.equal(rows(page).length, 3);
      assert.equal(skeleton(page, ".version-log"), undefined);
      assert.equal(skeleton(page, ".version-page"), undefined);

      service.holding = true;
      yield* press(page, "Luke1d4 changes");
      assert.equal(skeleton(page, ".version-page")?.says, "Reading the version…");
      assert.equal(body(page)?.includes("Only admins"), false);
      yield* release(service);
      assert.equal(skeleton(page, ".version-page"), undefined);
      assert.match(body(page) ?? "", /Only admins can invite\./u);
    }),
);

it.effect(
  "a version chosen is drawn beside the list with what it changed from the one before it marked, the newest row as any other",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(), yield* registryOnTestClock);

      yield* press(page, "Invite emails5h1 change");
      assert.equal(chosen(page), "Invite emails");
      assert.equal(restoreUnavailable(page), false);
      assert.deepEqual(marked(page, "del"), ["Only admins"]);
      assert.deepEqual(marked(page, "ins"), ["Any member"]);
      assert.equal(page.querySelector("[aria-label='Compare']"), null, "no other comparison");

      yield* press(page, "Luke2h2 changes");
      assert.equal(chosen(page), "Luke");
      assert.deepEqual(marked(page, "del"), ["reuse"]);
      assert.deepEqual(marked(page, ".version-added"), ["Decisions\nInvites expire."]);
    }),
);

/** The item of the row whose words read `row`. */
function itemOf(page: HTMLElement, row: string): HTMLElement {
  const item = [...page.querySelectorAll<HTMLElement>(".version-item")].find(
    (each) => each.querySelector(".version-row")?.textContent === row,
  );
  assert.ok(item, `no row reads "${row}"`);
  return item;
}

/** The items of the menu standing open, as they read. */
function menuItems(): string[] {
  return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
}

/** What each button of the row whose words read `row` is called, the row itself by its words. */
function rowButtons(page: HTMLElement, row: string): string[] {
  return [...itemOf(page, row).querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent ?? "",
  );
}

/** Presses the ⋯ of the row whose words read `row`, and answers the items of the menu it dropped. */
function openMenu(page: HTMLElement, row: string) {
  const ellipsis = itemOf(page, row).querySelector<HTMLButtonElement>(
    'button[aria-label="Version actions"]',
  );
  assert.ok(ellipsis, `no ⋯ on the row reading "${row}"`);
  return Effect.map(
    Effect.promise(() => act(async () => ellipsis.click())),
    menuItems,
  );
}

/** Right-clicks the row whose words read `row`, and answers the items of the menu it opened. */
function rightClick(page: HTMLElement, row: string) {
  const button = itemOf(page, row).querySelector(".version-row");
  assert.ok(button);
  return Effect.map(
    Effect.promise(() =>
      act(async () => {
        button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      }),
    ),
    menuItems,
  );
}

/** Closes the menu standing open, as Escape does. */
function closeMenu() {
  const menu = document.querySelector('[role="menu"]');
  assert.ok(menu, "no menu open");
  return Effect.promise(() =>
    act(async () => {
      menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }),
  );
}

it.effect(
  "a row carries one ⋯ beside it and nothing else, which drops the same menu its right-click opens",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(NOW, SECTIONED), yield* registryOnTestClock);

      assert.deepEqual(rowButtons(page, "Luke2h2 changes"), ["Luke2h2 changes", "Version actions"]);
      const dropped = yield* openMenu(page, "Luke2h2 changes");
      assert.deepEqual(dropped, ["Show changes", "Open in Work"]);
      yield* closeMenu();
      assert.deepEqual(yield* rightClick(page, "Luke2h2 changes"), dropped);
    }),
);

it.effect(
  "a version's Open in its menu goes where it was written: an agent's to its tab, Luke's on a call to the call, Luke's other saves to their moment in Work, and the developer's nowhere",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const [onCall, byAgent, offCall] = service.lines;
      assert.ok(onCall && byAgent && offCall);
      const callId = "1c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b22";
      service.lines[0] = { ...onCall, callId };
      service.lines.push({
        seq: 4,
        lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW - 30 * HOUR, duringCall: false },
        startedAt: NOW - 30 * HOUR,
        changes: 1,
      });
      const page = yield* mount(service, yield* registryOnTestClock);

      const opens = [
        ["Luke2h2 changes", "Open in Transcript"],
        ["Invite emails5h1 change", "Open Invite emails"],
        ["Luke1d4 changes", "Open in Work"],
      ] as const;
      for (const [row, open] of opens) {
        assert.ok((yield* openMenu(page, row)).includes(open), `no ${open} on "${row}"`);
        yield* press(document.body, open);
      }
      assert.deepEqual(shownSources, [
        { planId: PLAN_ID, source: { kind: REVISION_SOURCE.CALL, callId } },
        { planId: PLAN_ID, source: { kind: REVISION_SOURCE.AGENT, agentId: INVITE_AGENT.id } },
        { planId: PLAN_ID, source: { kind: REVISION_SOURCE.WORK, at: offCall.lastEdit.at } },
      ]);
      assert.equal(
        (yield* openMenu(page, "You1d1 change")).some((item) => item.startsWith("Open")),
        false,
      );
    }),
);

it.effect(
  "a version's menu offers only what applies to it: Show changes for several changes, its Open, and Restore for any but the plan as it stands",
  () =>
    Effect.gen(function* () {
      const service = fakeService(NOW, SECTIONED);
      service.lines.push({
        seq: 4,
        lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW - 30 * HOUR, duringCall: false },
        startedAt: NOW - 30 * HOUR,
        changes: 1,
      });
      const page = yield* mount(service, yield* registryOnTestClock);

      assert.deepEqual(yield* rightClick(page, "Luke1d4 changes"), [
        "Show changes",
        "Open in Work",
        "Restore this version",
      ]);
      yield* closeMenu();
      assert.deepEqual(yield* rightClick(page, "You1d1 change"), ["Restore this version"]);
    }),
);

it.effect("the plan as it stands, by the developer in one change, offers no menu at all", () =>
  Effect.gen(function* () {
    const service = fakeService();
    service.lines.unshift({
      seq: 4,
      lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW, duringCall: false },
      startedAt: NOW,
      changes: 1,
    });
    const page = yield* mount(service, yield* registryOnTestClock);

    assert.deepEqual(rowButtons(page, "Younow1 change"), ["Younow1 change"]);
    assert.deepEqual(yield* rightClick(page, "Younow1 change"), []);
  }),
);

it.effect("an archived plan's version menus offer no restore", () =>
  Effect.gen(function* () {
    const page = yield* mount(fakeService(), yield* registryOnTestClock, true);

    assert.deepEqual(yield* rightClick(page, "Luke1d4 changes"), ["Show changes", "Open in Work"]);
  }),
);

it.effect(
  "a version's Restore in its menu chooses it and asks, and the answer restores that version",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const page = yield* mount(service, yield* registryOnTestClock);

      yield* rightClick(page, "Luke1d4 changes");
      const menu = document.querySelector('[role="menu"]');
      assert.ok(menu);
      yield* press(menu, "Restore this version");
      assert.equal(chosen(page), "Luke");
      assert.equal(chosenSummary(page), "4 changes");
      assert.ok(document.querySelector('[role="alertdialog"]'), "the restore asks first");
      const cancel = [
        ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
      ].find((button) => button.textContent === "Cancel");
      assert.ok(cancel);
      yield* arrow("ArrowUp", cancel);
      assert.equal(
        chosenSummary(page),
        "4 changes",
        "the arrows in the question step nothing behind it",
      );
      yield* press(document, "Restore");
      assert.equal(service.current, FIRST);
    }),
);

it.effect("the arrows inside a version's menu are the menu's, and open nothing behind it", () =>
  Effect.gen(function* () {
    const page = yield* mount(fakeService(NOW, SECTIONED), yield* registryOnTestClock);

    yield* rightClick(page, "Luke2h2 changes");
    const item = document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]');
    assert.ok(item);
    yield* arrow("ArrowRight", item);
    assert.equal(sectionsOpen(page), false);
  }),
);

/** The versions of a plan whose newest revision changed one section and added another. */
const SECTIONED = [
  FIRST,
  documentOf(["## Goal\n\nAny member can invite."]),
  documentOf(["## Goal\n\nAny member can invite by email.", "## Decisions\n\nInvites expire."]),
];

/** Each section the open revision changed, as its row reads. */
function sectionRows(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".version-section-row")].map((row) => row.textContent ?? "");
}

/** The section whose row is lit. */
function chosenSection(page: HTMLElement): string | null | undefined {
  return page.querySelector('.version-section-row[aria-current="true"] .version-section-name')
    ?.textContent;
}

/** Whether the sections of a revision stand in the list's place. */
function sectionsOpen(page: HTMLElement): boolean {
  return page.querySelector(".version-log-track")?.getAttribute("data-opened") === "true";
}

/** Chooses Show changes from the ⋯ of the row whose words read `row`, which opens the sections its version changed. */
function openSections(page: HTMLElement, row: string) {
  return Effect.gen(function* () {
    yield* openMenu(page, row);
    yield* press(document.body, "Show changes");
  });
}

/** Runs the version history's Escape, as the window's keymap does. */
function pressEscape() {
  return Effect.promise(() =>
    act(async () => {
      runAppCommand(APP_COMMAND.EXIT_VERSION_HISTORY);
    }),
  );
}

it.effect(
  "only a version of several changes offers the sections it changed, never one change, a restore, or the plan before history",
  () =>
    Effect.gen(function* () {
      const service = fakeService(NOW, SECTIONED);
      service.lines.push({
        seq: 4,
        lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW - 30 * HOUR, duringCall: false },
        startedAt: NOW - 30 * HOUR,
        changes: 3,
        restoredFrom: { seq: 1, at: NOW - 26 * HOUR },
      });
      const page = yield* mount(service, yield* registryOnTestClock);

      const offered: boolean[] = [];
      for (const row of rows(page)) {
        offered.push((yield* rightClick(page, row.replaceAll(" · ", ""))).includes("Show changes"));
        yield* closeMenu();
      }
      assert.deepEqual(offered, [true, false, true, false]);
    }),
);

it.effect(
  "the keyboard's ring is drawn whole on every version row, its ⋯, and every row of the sections slid in",
  () =>
    Effect.gen(function* () {
      const styled = yield* Effect.promise(() => sheetStyle());
      const page = yield* mount(fakeService(NOW, SECTIONED), yield* registryOnTestClock);
      const clipped = () =>
        [...page.querySelectorAll<HTMLElement>(".version-log-track button")]
          .map((control) => ringClipping(styled, control))
          .filter(Boolean);

      assert.deepEqual(clipped(), []);
      yield* openSections(page, "Luke2h2 changes");
      assert.ok(page.querySelector(".version-section-row"), "the sections stand");
      assert.deepEqual(clipped(), []);
    }),
);

it.effect(
  "Show changes slides a version's sections in over the title, under who wrote it alone: each a row by its name, an added one saying so, the first drawn alone",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(NOW, SECTIONED), yield* registryOnTestClock);

      yield* openSections(page, "Luke2h2 changes");
      assert.equal(sectionsOpen(page), true);
      assert.ok(
        page.querySelector(".version-log-title")?.closest("[inert]"),
        "the title slid away",
      );
      assert.equal(page.querySelector(".version-sections-head")?.textContent, "Luke");
      assert.deepEqual(sectionRows(page), ["Goal", "DecisionsAdded"]);
      assert.equal(chosenSection(page), "Goal");
      assert.equal(page.querySelector(".version-page .plan-title"), null);
      assert.match(body(page) ?? "", /Any member can invite by email\./u);
      assert.doesNotMatch(body(page) ?? "", /Invites expire/u);

      yield* press(page, "DecisionsAdded");
      assert.equal(chosenSection(page), "Decisions");
      assert.deepEqual(marked(page, ".version-added"), ["Decisions\nInvites expire."]);
      assert.doesNotMatch(body(page) ?? "", /Any member/u);
    }),
);

it.effect(
  "over a version's sections, who wrote it opens where it was written, with a hint saying where, and the developer's own is not pressed",
  () =>
    Effect.gen(function* () {
      const service = fakeService(NOW, SECTIONED);
      service.lines.push({
        seq: 4,
        lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW - 30 * HOUR, duringCall: false },
        startedAt: NOW - 30 * HOUR,
        changes: 3,
      });
      const page = yield* mount(service, yield* registryOnTestClock);

      yield* openSections(page, "Luke2h2 changes");
      const head = page.querySelector<HTMLElement>(".version-sections-head");
      assert.equal(head?.tagName, "BUTTON");
      act(() => head?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
      assert.equal(hint(), "Open in Work");
      yield* press(page, "Luke");
      assert.deepEqual(
        shownSources.map((shown) => shown.source.kind),
        [REVISION_SOURCE.WORK],
      );

      yield* press(page, "All versions");
      yield* openSections(page, "You1d3 changes");
      assert.equal(page.querySelector(".version-sections-head")?.tagName, "P");
      assert.equal(
        [...page.querySelectorAll(".version-log button")].some(
          (each) => each.textContent === "You",
        ),
        false,
      );
    }),
);

it.effect(
  "the arrows step through the sections and right opens them, and Escape, the left arrow, and All versions each go back to the versions with the version still chosen",
  () =>
    Effect.gen(function* () {
      const page = yield* mount(fakeService(NOW, SECTIONED), yield* registryOnTestClock);

      yield* arrow("ArrowRight");
      assert.equal(sectionsOpen(page), true);
      yield* arrow("ArrowDown");
      assert.equal(chosenSection(page), "Decisions");
      assert.equal(document.activeElement?.textContent, "DecisionsAdded");
      yield* arrow("ArrowDown");
      assert.equal(chosenSection(page), "Decisions", "the last section, past which there is none");
      yield* arrow("ArrowUp");
      assert.equal(chosenSection(page), "Goal");

      yield* pressEscape();
      assert.equal(sectionsOpen(page), false);
      assert.equal(page.querySelector(".plan-as-it-stands"), null, "Escape went back, not out");
      assert.equal(chosen(page), "Luke");
      assert.equal(
        page.querySelector(".version-page .plan-title")?.textContent,
        "Teammate invitations",
      );

      yield* arrow("ArrowRight");
      yield* arrow("ArrowLeft");
      assert.equal(sectionsOpen(page), false);

      yield* arrow("ArrowRight");
      yield* press(page, "All versions");
      assert.equal(sectionsOpen(page), false);
      yield* pressEscape();
      assert.ok(page.querySelector(".plan-as-it-stands"), "Escape over the versions leaves");
    }),
);

/** Lands a save at the moment given, and lets what it read again land. */
function landSave(at: number) {
  return Effect.promise(() =>
    act(async () => {
      saved?.(at);
    }),
  );
}

it.effect(
  "a save that joins the open version keeps the section chosen by its name, though a section written before it moves it down",
  () =>
    Effect.gen(function* () {
      const versions = [...SECTIONED];
      const page = yield* mount(fakeService(NOW, versions), yield* registryOnTestClock);
      yield* openSections(page, "Luke2h2 changes");
      yield* press(page, "DecisionsAdded");

      versions[2] = documentOf([
        "## Goal\n\nAny member can invite by email.",
        "## Risks\n\nSpam.",
        "## Decisions\n\nInvites expire.",
      ]);
      yield* landSave(NOW);
      assert.deepEqual(sectionRows(page), ["Goal", "RisksAdded", "DecisionsAdded"]);
      assert.equal(chosenSection(page), "Decisions");
      assert.match(body(page) ?? "", /Invites expire/u);
    }),
);

it.effect(
  "a newer version landing while the newest's sections are open moves the history on to it, and the sections give way",
  () =>
    Effect.gen(function* () {
      const versions = [...SECTIONED];
      const service = fakeService(NOW, versions);
      const page = yield* mount(service, yield* registryOnTestClock);
      yield* openSections(page, "Luke2h2 changes");
      assert.equal(sectionsOpen(page), true);

      versions.push(documentOf(["## Goal\n\nAnyone can invite."]));
      service.lines.unshift({
        seq: 4,
        lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: NOW, duringCall: false },
        startedAt: NOW,
        changes: 1,
      });
      yield* landSave(NOW);
      assert.equal(sectionsOpen(page), false);
      assert.equal(chosen(page), "You");
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
      assert.match(body(page) ?? "", /Only admins can invite\./u);
      assert.equal(page.querySelector(".version-note"), null, "drawn without a word over it");

      yield* arrow("ArrowUp");
      yield* arrow("ArrowUp");
      yield* arrow("ArrowUp");
      assert.equal(chosen(page), "Luke");
      assert.equal(restoreUnavailable(page), true);
    }),
);

it.effect(
  "over the plan as it stands, Restore this version says it is already current on hover and on keyboard focus, and a press restores nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const page = yield* mount(service, yield* registryOnTestClock);
      const restore = restoreButton(page);
      assert.ok(restore);

      act(() => restore.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
      assert.equal(hint(), "This version is already current");
      act(() => {
        restore.dispatchEvent(
          new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
        );
      });
      assert.equal(hint(), undefined);

      document.documentElement.dataset.keyboard = "true";
      act(() => restore.focus());
      assert.equal(hint(), "This version is already current");
      assert.equal(
        document.getElementById(restore.getAttribute("aria-describedby") ?? "")?.textContent,
        "This version is already current",
      );

      yield* press(page, "Restore this version");
      assert.equal(document.querySelector('[role="alertdialog"]'), null);
      assert.equal(service.current, LATEST);

      yield* press(page, "Invite emails5h1 change");
      act(() => restoreButton(page)?.focus());
      assert.equal(hint(), undefined, "an older version's Restore needs no hint");
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

it.effect("an archived plan's versions are read, and none of them offers a restore", () =>
  Effect.gen(function* () {
    const page = yield* mount(fakeService(), yield* registryOnTestClock, true);

    yield* press(page, "Luke1d4 changes");

    assert.equal(chosen(page), "Luke");
    assert.equal(restoreButton(page), undefined);
  }),
);

it.effect(
  "a restore's question still standing when the plan is archived elsewhere is taken down",
  () =>
    Effect.gen(function* () {
      const service = fakeService();
      const page = yield* mount(service, yield* registryOnTestClock);
      yield* press(page, "Luke1d4 changes");
      yield* press(page, "Restore this version");
      assert.ok(document.querySelector('[role="alertdialog"]'), "the question stands");

      yield* Effect.promise(() => act(async () => archive?.()));

      assert.equal(document.querySelector('[role="alertdialog"]'), null);
      assert.equal(service.current, LATEST);
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
      yield* press(page, "Retry");
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
      assert.match(body(page) ?? "", /Only admins can invite\./u);
      assert.equal(page.querySelector(".version-note"), null);
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

it.effect(
  "opened from a section's \"Edited by\", the view draws the version that made the section's last save, its row lit",
  () =>
    Effect.gen(function* () {
      // The section's save is stamped a moment before the revision it began.
      const save = NOW - 5 * HOUR - 4;
      const page = yield* mount(fakeService(), yield* registryOnTestClock, false, save);

      assert.equal(chosen(page), "Invite emails");
      assert.equal(restoreUnavailable(page), false);
      assert.deepEqual(marked(page, "del"), ["Only admins"]);
      assert.deepEqual(marked(page, "ins"), ["Any member"]);
    }),
);

it.effect(
  "a save older than the newest page is sought on the older pages, the page standing quiet until it is found, and the plan as it stands is drawn where they cannot be read",
  () =>
    Effect.gen(function* () {
      const save = NOW - 26 * HOUR;
      const older: (() => void)[] = [];
      const paged = (failing: boolean) => {
        const service = fakeService();
        service.source.readPage = (_planId, before) =>
          before === undefined
            ? Promise.resolve({ revisions: service.lines.slice(0, 1), earlier: 3 })
            : new Promise((land) =>
                older.push(() =>
                  land(
                    failing
                      ? { failure: PLAN_CALL_FAILURE.UNANSWERED }
                      : { revisions: service.lines.slice(1) },
                  ),
                ),
              );
        return service;
      };
      const landOlder = Effect.promise(() =>
        act(async () => {
          for (const land of older.splice(0)) land();
        }),
      );

      const page = yield* mount(paged(false), yield* registryOnTestClock, false, save);
      assert.equal(rows(page).length, 1);
      assert.equal(chosenSummary(page), undefined);
      assert.equal(skeleton(page, ".version-page")?.says, "Reading the version…");
      yield* landOlder;
      assert.equal(rows(page).length, 3);
      assert.equal(chosenSummary(page), "4 changes");
      assert.match(body(page) ?? "", /Only admins can invite\./u);
      act(() => root?.unmount());
      document.body.replaceChildren();

      const failed = yield* mount(paged(true), yield* registryOnTestClock, false, save);
      yield* landOlder;
      assert.equal(chosenSummary(failed), "2 changes", "the plan as it stands");
      assert.equal(restoreUnavailable(failed), true);
    }),
);

it.effect(
  "an older page that fails after the view opened on another plan's save leaves that save sought",
  () =>
    Effect.gen(function* () {
      const OTHER_ID = "0c9a3f1e-6b2d-4e8f-a1c7-3d5e7f9a1b2c";
      const lines = fakeService().lines;
      /** Every page read waits here, by plan, until the test answers it; the first plan's older pages fail. */
      const pages: { planId: string; before: number | undefined; land: () => void }[] = [];
      const source: PlanHistorySource = {
        readPage: (planId, before) =>
          new Promise((land) =>
            pages.push({
              planId,
              before,
              land: () =>
                land(
                  before === undefined
                    ? { revisions: lines.slice(0, 1), earlier: 3 }
                    : planId === PLAN_ID
                      ? { failure: PLAN_CALL_FAILURE.UNANSWERED }
                      : { revisions: lines.slice(1) },
                ),
            }),
          ),
        readRevision: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
        restore: () => Promise.resolve(false),
      };
      const answer = (planId: string, before: number | undefined) =>
        Effect.promise(() =>
          act(async () => {
            const at = pages.findIndex((page) => page.planId === planId && page.before === before);
            pages.splice(at, 1)[0]?.land();
          }),
        );
      let selected: () => number | undefined = () => undefined;
      let openOn: (planId: string, seek: number) => void = () => undefined;
      function Harness() {
        const [opened, setOpened] = useState({ planId: PLAN_ID, seek: NOW - 26 * HOUR });
        openOn = (planId, seek) => setOpened({ planId, seek });
        const history = usePlanHistory({
          source,
          planId: opened.planId,
          editedAt: undefined,
          name: "Teammate invitations",
          shown: true,
          seek: opened.seek,
          returnTo: undefined,
          onRestored: () => undefined,
        });
        selected = () => history.selected;
        return null;
      }
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      yield* Effect.promise(() => act(async () => root?.render(createElement(Harness))));

      // The first plan's save is on a page past its first, whose read is on its way.
      yield* answer(PLAN_ID, undefined);
      assert.ok(pages.some((page) => page.planId === PLAN_ID && page.before === 3));
      act(() => openOn(OTHER_ID, NOW - 5 * HOUR));
      yield* answer(PLAN_ID, 3);
      yield* answer(OTHER_ID, undefined);
      yield* answer(OTHER_ID, 3);

      assert.equal(selected(), 2, "the other plan's save found, not given way to its newest");
    }),
);

it.effect(
  "a version gone back to on a page past the first is read for on older pages, and gives way to the newest where the history holds none",
  () =>
    Effect.gen(function* () {
      const lines = fakeService().lines;
      /** The first page holds the two newest revisions; the oldest is on the page before them. */
      const source: PlanHistorySource = {
        readPage: (_planId, before) =>
          Promise.resolve(
            before === undefined
              ? { revisions: lines.slice(0, 2), earlier: 2 }
              : { revisions: lines.slice(2) },
          ),
        readRevision: () => Promise.resolve({ failure: PLAN_CALL_FAILURE.UNANSWERED }),
        restore: () => Promise.resolve(false),
      };
      let viewed: () => number | undefined = () => undefined;
      let returnOn: (revision: number) => void = () => undefined;
      function Harness() {
        const [revision, setRevision] = useState(1);
        returnOn = setRevision;
        const history = usePlanHistory({
          source,
          planId: PLAN_ID,
          editedAt: undefined,
          name: "Teammate invitations",
          shown: revision !== 0,
          seek: undefined,
          returnTo: { revision, opened: undefined },
          onRestored: () => undefined,
        });
        viewed = () => history.viewing?.line.seq;
        return null;
      }
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      const settle = Effect.promise(() => act(async () => undefined));
      yield* Effect.promise(() => act(async () => root?.render(createElement(Harness))));
      yield* settle;
      yield* settle;
      assert.equal(viewed(), 1, "the oldest revision, read from the page before the first");

      act(() => returnOn(0));
      act(() => returnOn(9));
      yield* settle;
      yield* settle;
      assert.equal(viewed(), 3, "a revision the history does not hold gives way to the newest");
    }),
);

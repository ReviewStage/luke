// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import type { MemorySummary } from "@repo/features/memory-wire";
import { WORKSPACE_ROLE, type Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  type AppHostRead,
  type AppMemories,
  type AppStateDelivery,
  NO_KEYS_HELD,
} from "@repo/host/app-state";
import type { PortActKind, PortActResult } from "@repo/host/contract";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { chooseMenuItem, menuItems } from "../testing/phone-head.js";
import { MemorySection } from "./memory-page.js";

const READER = "user-reader";

const ACME: Workspace = {
  id: "workspace-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

const GLOBEX: Workspace = { ...ACME, id: "workspace-globex", name: "Globex" };

const DEPLOYS: MemorySummary = {
  id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
  text: "Deployments go out from the release branch through Vercel.",
  keptBy: { userId: READER, name: "Rita Reader" },
  forgettable: true,
  createdAt: Date.UTC(2026, 9, 10, 12),
  updatedAt: Date.UTC(2026, 9, 12, 12),
};

const TESTS: MemorySummary = {
  id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  text: "The web server's store tests run on PGlite through test:store.",
  keptBy: { userId: "user-dean", name: "Dean" },
  forgettable: false,
  createdAt: Date.UTC(2026, 9, 9, 12),
  updatedAt: Date.UTC(2026, 9, 9, 12),
};

let stored: Readonly<Record<string, readonly MemorySummary[]>> = {};
let sent: AnyAct[] = [];
let readFails = false;
let refuseForget = false;
let readsNothing = false;
let laid: AppMemories = NO_KEYS_HELD;
let version = 1;
const listeners = new Set<(delivery: AppStateDelivery) => void>();

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

const unanswered = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

function lay(workspaceId: string, read: AppHostRead<readonly MemorySummary[]>): void {
  laid = { ...laid, [workspaceId]: read };
  version += 1;
  for (const listener of [...listeners]) {
    listener({ version, entries: { [LIVE_READ.MEMORIES]: laid } });
  }
}

function layRead(workspaceId: string): void {
  if (readsNothing) return;
  lay(workspaceId, readFails ? { failed: true } : { rows: stored[workspaceId] ?? [] });
}

function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.MEMORIES_FOLLOW: {
      const { workspaceId } = request.payload;
      void Promise.resolve().then(() => layRead(workspaceId));
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
    }
    case ACT_KIND.MEMORIES_RETRY:
      layRead(request.payload.workspaceId);
      return Promise.resolve(done(undefined));
    case ACT_KIND.MEMORIES_FORGET: {
      const { workspaceId, id } = request.payload;
      const before = stored[workspaceId] ?? [];
      const after = before.filter((memory) => memory.id !== id);
      lay(workspaceId, { rows: after });
      if (refuseForget) {
        lay(workspaceId, { rows: before });
        return Promise.resolve(done(unanswered));
      }
      stored = { ...stored, [workspaceId]: after };
      return Promise.resolve(done({ memories: after }));
    }
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = { [ACME.id]: [DEPLOYS, TESTS] };
  sent = [];
  readFails = false;
  refuseForget = false;
  readsNothing = false;
  laid = NO_KEYS_HELD;
  version = 1;
  listeners.clear();
  fakeActs({
    act: answer,
    requestAppState: () => Promise.resolve(stateWith({}, { version, [LIVE_READ.MEMORIES]: laid })),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

interface WorkspacesRead {
  readonly failed: boolean;
  readonly retry: () => void;
}

const WORKSPACES_READ: WorkspacesRead = { failed: false, retry: () => undefined };

async function mount(
  signedIn = true,
  workspace: Workspace | null = ACME,
  workspaces: WorkspacesRead = WORKSPACES_READ,
): Promise<{
  readonly page: HTMLElement;
  readonly show: (next: Workspace, readerId?: string) => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (shown: Workspace | null, readerId: string | undefined) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(MemorySection, {
            signedIn,
            workspace: shown ?? undefined,
            readerId,
            workspacesFailed: workspaces.failed,
            onRetryWorkspaces: workspaces.retry,
          }),
        ),
      ),
    );
  const read = () =>
    readsNothing
      ? Promise.resolve()
      : vi.waitFor(() =>
          assert.equal(container.textContent?.includes("Reading Vespin's memory"), false),
        );
  draw(workspace, signedIn ? READER : undefined);
  await settle();
  await read();
  return {
    page: container,
    show: async (next, readerId = READER) => {
      draw(next, readerId);
      await settle();
      await read();
    },
  };
}

const rows = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>(".memory-row")];

const words = (page: HTMLElement) =>
  rows(page).map((row) => row.querySelector(".memory-text")?.textContent);

const rowOf = (page: HTMLElement, memory: MemorySummary) =>
  rows(page).find((row) => row.querySelector(".memory-text")?.textContent === memory.text) ??
  assert.fail(`no row for ${memory.id}`);

const button = (within: Element, label: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === label && each.closest("[inert]") === null,
  ) ?? assert.fail(`no ${label} button`);

const dialog = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]') ?? assert.fail("no question");

const pressOf = (page: HTMLElement, memory: MemorySummary) =>
  rowOf(page, memory).querySelector<HTMLButtonElement>("[data-card-press]") ??
  assert.fail("no press on the row");

function openMenu(page: HTMLElement, memory: MemorySummary): void {
  const more =
    rowOf(page, memory).querySelector<HTMLButtonElement>('button[aria-label="Memory actions"]') ??
    assert.fail("no ⋯ on the row");
  act(() => more.click());
}

function askForget(page: HTMLElement, memory: MemorySummary): void {
  openMenu(page, memory);
  chooseMenuItem("Delete");
}

async function forget(page: HTMLElement, memory: MemorySummary): Promise<boolean> {
  askForget(page, memory);
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.MEMORIES_FORGET);
  act(() => button(dialog(), "Delete memory").click());
  await settle();
  return askedFirst;
}

async function searchFor(page: HTMLElement, query: string): Promise<void> {
  const field =
    page.querySelector<HTMLInputElement>('input[aria-label="Search memories"]') ??
    assert.fail("no search");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, query);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

test("what Vespin kept in the workspace is held for it and listed in the service's order, each memory's words whole and named by whose they are, and kept out of the screen recording", async () => {
  const { page } = await mount();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FOLLOW)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }],
  );
  assert.deepEqual(words(page), [DEPLOYS.text, TESTS.text]);
  const keeper = (memory: MemorySummary) =>
    rowOf(page, memory).querySelector(".ui-comment-head")?.textContent ?? "";
  assert.match(keeper(DEPLOYS), /^You/u);
  assert.match(keeper(TESTS), /^Dean/u);
  assert.ok(
    rowOf(page, DEPLOYS).closest(".ph-no-capture"),
    "the rows are under the unrecorded class",
  );
});

test("a memory's code in backticks is drawn as inline code, never as the backticks themselves", async () => {
  const written = { ...TESTS, text: "Run `pnpm db:generate` after changing a schema." };
  stored = { [ACME.id]: [written] };
  const { page } = await mount();

  const code = [
    ...rowOf(page, {
      ...written,
      text: "Run pnpm db:generate after changing a schema.",
    }).querySelectorAll("code"),
  ];
  assert.deepEqual(
    code.map((each) => each.textContent),
    ["pnpm db:generate"],
  );
  assert.doesNotMatch(page.textContent ?? "", /`/u);
});

test("Delete asks first, then deletes the memory for good and lists what the host then holds", async () => {
  const { page } = await mount();

  const askedFirst = await forget(page, DEPLOYS);

  assert.equal(askedFirst, true);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FORGET)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, id: DEPLOYS.id }],
  );
  await vi.waitFor(() => expect(words(page)).toEqual([TESTS.text]));
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("a memory a search hid comes back unchosen, so a later act on what is chosen leaves it be", async () => {
  const { page } = await mount();
  act(() => {
    pressOf(page, DEPLOYS).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
    );
  });

  await searchFor(page, "store");
  await searchFor(page, "");

  assert.ok(page.querySelector('[role="toolbar"]') === null, "nothing stands chosen");
  assert.equal(pressOf(page, DEPLOYS).getAttribute("data-selected"), null);
});

test("a forget that fails says so in the dialog and keeps the memory listed", async () => {
  refuseForget = true;
  const { page } = await mount();

  await forget(page, DEPLOYS);

  assert.deepEqual(words(page), [DEPLOYS.text, TESTS.text]);
  assert.equal(
    dialog().querySelector('[data-slot="field-error"]:not(:empty)')?.textContent,
    "The memory could not be deleted. Try again.",
  );
});

test("the search keeps the memories whose words or keeper hold it", async () => {
  const { page } = await mount();

  await searchFor(page, "vercel");

  assert.deepEqual(words(page), [DEPLOYS.text]);
  await searchFor(page, "dean");
  assert.deepEqual(words(page), [TESTS.text]);
});

test("a memory the reader may not delete offers Delete unavailable, saying who may", async () => {
  const { page } = await mount();

  openMenu(page, TESTS);

  assert.deepEqual(
    menuItems().find((item) => item.label === "Delete"),
    { label: "Delete", disabled: true },
  );
  assert.match(
    document.querySelector('[role="menu"]')?.textContent ?? "",
    /Only Dean, or an owner or admin/u,
  );
});

test("several memories chosen are forgotten on one question, one after another, those the reader may not forget left and said so", async () => {
  const pricing: MemorySummary = {
    ...DEPLOYS,
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    text: "Pricing lives in the billing service.",
  };
  stored = { [ACME.id]: [DEPLOYS, pricing, TESTS] };
  const { page } = await mount();

  for (const memory of [DEPLOYS, pricing, TESTS]) {
    act(() => {
      pressOf(page, memory).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
      );
    });
  }
  act(() => button(page.querySelector('[role="toolbar"]') ?? page, "Delete").click());
  assert.match(
    dialog().textContent ?? "",
    /Delete 3 memories\?.*1 memory you may not delete stays\./u,
  );
  act(() => button(dialog(), "Delete memories").click());
  await settle();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FORGET)
      .map((request) => request.payload),
    [
      { workspaceId: ACME.id, id: DEPLOYS.id },
      { workspaceId: ACME.id, id: pricing.id },
    ],
  );
  await vi.waitFor(() => expect(words(page)).toEqual([TESTS.text]));
});

test("showing another workspace holds that workspace's memories in place of the first's", async () => {
  stored = { ...stored, [GLOBEX.id]: [] };
  const { page, show } = await mount();

  await show(GLOBEX);

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FOLLOW)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: GLOBEX.id }],
  );
  assert.deepEqual(words(page), []);
  assert.match(page.textContent ?? "", /hasn't remembered anything yet/u);
});

test("a workspace Vespin has remembered nothing in says so", async () => {
  stored = { [ACME.id]: [] };
  const { page } = await mount();

  assert.deepEqual(words(page), []);
  assert.match(page.textContent ?? "", /Vespin hasn't remembered anything yet\./u);
});

test("a read that fails offers to try again, and no account holds nothing", async () => {
  readFails = true;
  const { page: signedOut } = await mount(false);
  assert.equal(signedOut.textContent, "Sign in to use this page.");
  assert.deepEqual(
    sent.filter((request) => request.kind === ACT_KIND.MEMORIES_FOLLOW),
    [],
    "the signed-out page holds nothing",
  );
  const { page: failed } = await mount();

  assert.match(failed.textContent ?? "", /Vespin's memory could not be read\./u);
  readFails = false;
  act(() => button(failed, "Retry").click());
  await settle();
  await vi.waitFor(() => assert.deepEqual(words(failed), [DEPLOYS.text, TESTS.text]));
});

test("while the memories are read the page says Reading, which is neither its failure nor its empty line", async () => {
  readsNothing = true;
  const { page } = await mount();

  const status = page.querySelector('[role="status"]') ?? assert.fail("no reading region");
  assert.equal(status.textContent, "Reading Vespin's memory");
  assert.doesNotMatch(page.textContent ?? "", /could not be read|hasn't remembered/u);
});

test("before the workspaces are read the page says Reading, and does not say none is open", async () => {
  const { page } = await mount(true, null);

  const status = page.querySelector('[role="status"]') ?? assert.fail("no reading region");
  assert.equal(status.textContent, "Reading your workspaces");
  assert.doesNotMatch(page.textContent ?? "", /none is open/u);
  assert.equal(sent.length, 0, "no workspace is a memory read of none");
});

test("workspaces that could not be read say so with Retry, which asks for them again", async () => {
  let retried = 0;
  const { page } = await mount(true, null, { failed: true, retry: () => (retried += 1) });

  assert.match(page.textContent ?? "", /Your workspaces could not be read\./u);
  act(() => button(page, "Retry").click());
  assert.equal(retried, 1);
});

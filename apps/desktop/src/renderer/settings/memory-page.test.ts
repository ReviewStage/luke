// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { MemorySummary } from "@luke/features/memory-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import {
  ACT_KIND,
  ACT_OUTCOME_STATUS,
  type Act,
  type ActKind,
  type ActOutcome,
  type ActResultFor,
} from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { MemorySection } from "./memory-page";

/**
 * Settings › Memory over a bridge answering as the host would: the memories
 * of the workspace Settings shows are read for that workspace, listed in the
 * service's order with their words whole and whose words they are; Forget
 * stands only on a memory the reader may forget, asks first in the confirm
 * dialog, and the memory leaves the list once the service says so; a forget
 * that fails says so in the dialog and keeps the memory listed; another
 * workspace reads its own memories; and a read that fails offers to try
 * again. Synthetic workspaces, members, and memories.
 */

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

/** The memories the test's service holds, read and forgotten by the page. */
let stored: MemorySummary[] = [];
/** Every act the page sent, in order. */
let sent: Act[] = [];
/** Whether the read is answered with a failure rather than the memories. */
let refuseRead = false;
/** Whether a forget is answered with a failure rather than the memories. */
let refuseForget = false;

const done = (value: ActResultFor<ActKind>): ActOutcome => ({
  status: ACT_OUTCOME_STATUS.DONE,
  value,
});

const unanswered = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The bridge, answering the page's acts the way the host would. */
function answer(request: Act): Promise<ActOutcome> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.MEMORIES_READ:
      return Promise.resolve(done(refuseRead ? unanswered : { memories: stored }));
    case ACT_KIND.MEMORIES_FORGET:
      if (refuseForget) return Promise.resolve(done(unanswered));
      stored = stored.filter((memory) => memory.id !== request.payload.id);
      return Promise.resolve(done({ memories: stored }));
    default:
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = [DEPLOYS, TESTS];
  sent = [];
  refuseRead = false;
  refuseForget = false;
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: { act: answer, recordSurfaceEvent: () => undefined },
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

async function mount(
  signedIn = true,
  workspace: Workspace | undefined = ACME,
): Promise<{
  readonly page: HTMLElement;
  readonly show: (next: Workspace) => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (shown: Workspace | undefined) =>
    act(() =>
      root.render(
        createElement(MemorySection, {
          signedIn,
          workspace: shown,
          readerId: signedIn ? READER : undefined,
        }),
      ),
    );
  draw(workspace);
  await settle();
  return {
    page: container,
    show: async (next) => {
      draw(next);
      await settle();
    },
  };
}

const rows = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>(".menu-row")];

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

/** Chooses Forget in a memory's ⋯, then the dialog's own Forget; answers whether it asked before forgetting. */
async function forget(page: HTMLElement, memory: MemorySummary): Promise<boolean> {
  const ellipsis =
    rowOf(page, memory).querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]') ??
    assert.fail("no ⋯");
  act(() => ellipsis.click());
  act(() =>
    (
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === "Forget",
      ) ?? assert.fail("no Forget in the ⋯")
    ).click(),
  );
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.MEMORIES_FORGET);
  act(() => button(dialog(), "Forget").click());
  await settle();
  return askedFirst;
}

test("what Luke kept in the workspace is read for it and listed in the service's order, each memory's words whole and named by whose they are, and kept out of the screen recording", async () => {
  const { page } = await mount();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_READ)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }],
  );
  assert.match(page.textContent ?? "", /planning calls in Acme/u);
  assert.match(page.textContent ?? "", /Everyone in the workspace shares these memories/u);
  assert.deepEqual(words(page), [DEPLOYS.text, TESTS.text]);
  assert.match(rowOf(page, DEPLOYS).textContent ?? "", /Kept by You · Oct 12, 2026/u);
  assert.match(rowOf(page, TESTS).textContent ?? "", /Kept by Dean · /u);
  assert.ok(
    rowOf(page, DEPLOYS).closest(".ph-no-capture"),
    "the rows are under the unrecorded class",
  );
});

test("Forget asks first, then forgets the memory for good and lists what the service then keeps", async () => {
  const { page } = await mount();

  const askedFirst = await forget(page, DEPLOYS);

  assert.equal(askedFirst, true);
  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_FORGET)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id, id: DEPLOYS.id }],
  );
  assert.deepEqual(words(page), [TESTS.text]);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
});

test("a forget that fails says so in the dialog and keeps the memory listed", async () => {
  refuseForget = true;
  const { page } = await mount();

  await forget(page, DEPLOYS);

  assert.deepEqual(words(page), [DEPLOYS.text, TESTS.text]);
  assert.equal(
    dialog().querySelector('[role="alert"]')?.textContent,
    "The memory could not be forgotten. Try again.",
  );
});

test("a memory whose member's account is gone reads as kept by a former member", async () => {
  stored = [{ ...TESTS, keptBy: null }];
  const { page } = await mount();

  assert.match(rowOf(page, TESTS).textContent ?? "", /Kept by a former member · /u);
});

test("a memory the reader may not forget offers no ⋯ at all", async () => {
  const { page } = await mount();

  assert.equal(rowOf(page, TESTS).querySelector('button[aria-haspopup="menu"]'), null);
  assert.ok(rowOf(page, DEPLOYS).querySelector('button[aria-haspopup="menu"]'));
});

test("showing another workspace reads that workspace's memories in place of the first's", async () => {
  const { page, show } = await mount();
  stored = [];

  await show(GLOBEX);

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_READ)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: GLOBEX.id }],
  );
  assert.deepEqual(words(page), []);
  assert.match(page.textContent ?? "", /planning calls in Globex/u);
});

test("a workspace Luke has remembered nothing in says so", async () => {
  stored = [];
  const { page } = await mount();

  assert.deepEqual(words(page), []);
  assert.match(page.textContent ?? "", /Luke hasn't remembered anything yet\./u);
});

test("a read that fails offers to try again, and no account reads nothing", async () => {
  refuseRead = true;
  const { page: failed } = await mount();
  const { page: signedOut } = await mount(false);

  assert.match(failed.textContent ?? "", /Luke's memory could not be read\./u);
  refuseRead = false;
  act(() => button(failed, "Retry").click());
  await settle();
  assert.deepEqual(words(failed), [DEPLOYS.text, TESTS.text]);
  assert.equal(signedOut.textContent, "Sign in to see what Luke remembers.");
  assert.equal(
    sent.filter((request) => request.kind === ACT_KIND.MEMORIES_READ).length,
    2,
    "the signed-out page reads nothing",
  );
});

// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import type { MemorySummary } from "@luke/features/memory-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind, PortActResult } from "@luke/host/contract";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "../testing/app-bridge.js";
import { chooseMenuItem, menuItems } from "../testing/phone-head.js";
import { MemorySection } from "./memory-page.js";

/**
 * Settings › Memory over a bridge answering as the host would: the memories
 * of the workspace Settings shows are read for that workspace, listed in the
 * service's order with their words whole and whose words they are, and a
 * press on one says all it holds; the workspace's and the reader's own stand
 * on two sides of a switcher, each counting what the search leaves of it;
 * Forget is offered from a memory's ⋯, unavailable on one the reader may not
 * forget, asks first in the confirm dialog, and the memory leaves the list
 * once the service says so; several chosen are forgotten one after another
 * on one question; a forget that fails says so in the dialog and keeps the
 * memory listed; another workspace reads its own memories; and a read that
 * fails offers to try again. Synthetic workspaces, members, and memories.
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
  private: false,
  createdAt: Date.UTC(2026, 9, 10, 12),
  updatedAt: Date.UTC(2026, 9, 12, 12),
};

const TESTS: MemorySummary = {
  id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
  text: "The web server's store tests run on PGlite through test:store.",
  keptBy: { userId: "user-dean", name: "Dean" },
  forgettable: false,
  private: false,
  createdAt: Date.UTC(2026, 9, 9, 12),
  updatedAt: Date.UTC(2026, 9, 9, 12),
};

/** The memories the test's service holds, read and forgotten by the page. */
let stored: MemorySummary[] = [];
/** Every act the page sent, in order. */
let sent: AnyAct[] = [];
/** Whether the read is answered with a failure rather than the memories. */
let refuseRead = false;
/** Whether a forget is answered with a failure rather than the memories. */
let refuseForget = false;
/** Where a forget is held unanswered until the test lets it go, rather than answered at once. */
let holdForgets: ((answer: FakeActAnswer) => void)[] | undefined;
/** Where a read is held unanswered until the test lets it go, rather than answered at once. */
let holdReads: ((answer: FakeActAnswer) => void)[] | undefined;

const done = (value: PortActResult<PortActKind>): FakeActAnswer => ({
  status: FAKE_ANSWER.DONE,
  value,
});

const unanswered = { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED } as const;

/** The bridge, answering the page's acts the way the host would. */
function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);
  switch (request.kind) {
    case ACT_KIND.MEMORIES_READ:
      if (holdReads !== undefined) {
        const held = holdReads;
        return new Promise((resolve) => held.push(resolve));
      }
      return Promise.resolve(done(refuseRead ? unanswered : { memories: stored }));
    case ACT_KIND.MEMORIES_FORGET:
      if (refuseForget) return Promise.resolve(done(unanswered));
      if (holdForgets !== undefined) {
        const held = holdForgets;
        return new Promise((resolve) => held.push(resolve));
      }
      stored = stored.filter((memory) => memory.id !== request.payload.id);
      return Promise.resolve(done({ memories: stored }));
    default:
      return Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT });
  }
}

const roots: Root[] = [];

beforeEach(() => {
  stored = [DEPLOYS, TESTS];
  sent = [];
  refuseRead = false;
  refuseForget = false;
  holdForgets = undefined;
  holdReads = undefined;
  fakeActs({ act: answer });
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

/** How the workspaces' own read stands, which the page is handed beside the workspace it shows. */
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
  const draw = (shown: Workspace | null, readerId: string | undefined) =>
    act(() =>
      root.render(
        createElement(MemorySection, {
          signedIn,
          workspace: shown ?? undefined,
          readerId,
          workspacesFailed: workspaces.failed,
          onRetryWorkspaces: workspaces.retry,
        }),
      ),
    );
  draw(workspace, signedIn ? READER : undefined);
  await settle();
  return {
    page: container,
    show: async (next, readerId = READER) => {
      draw(next, readerId);
      await settle();
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

/** A memory row's own press, which opens what it holds and is what ⌘ chooses. */
const pressOf = (page: HTMLElement, memory: MemorySummary) =>
  rowOf(page, memory).querySelector<HTMLButtonElement>("[data-card-press]") ??
  assert.fail("no press on the row");

/** Opens a memory's ⋯. */
function openMenu(page: HTMLElement, memory: MemorySummary): void {
  const more =
    rowOf(page, memory).querySelector<HTMLButtonElement>('button[aria-label="Memory actions"]') ??
    assert.fail("no ⋯ on the row");
  act(() => more.click());
}

/** Chooses Forget from a memory's ⋯, which puts its question up. */
function askForget(page: HTMLElement, memory: MemorySummary): void {
  openMenu(page, memory);
  chooseMenuItem("Forget");
}

/** Asks Forget, then presses the dialog's own Forget; answers whether it asked before forgetting. */
async function forget(page: HTMLElement, memory: MemorySummary): Promise<boolean> {
  askForget(page, memory);
  const askedFirst = !sent.some((request) => request.kind === ACT_KIND.MEMORIES_FORGET);
  act(() => button(dialog(), "Forget").click());
  await settle();
  return askedFirst;
}

/** The switcher's sides, each its name and its count. */
const sides = (page: HTMLElement) =>
  [...page.querySelectorAll<HTMLElement>('[aria-label="Whose memories"] [role="radio"]')].map(
    (side) => side.textContent,
  );

/** Shows the switcher's side whose name starts with `name`. */
function showSide(page: HTMLElement, name: string): void {
  const side =
    [...page.querySelectorAll<HTMLElement>('[aria-label="Whose memories"] [role="radio"]')].find(
      (each) => each.textContent?.startsWith(name),
    ) ?? assert.fail(`no ${name} side`);
  act(() => side.click());
}

/** Types `query` over whatever the search holds, as the developer would. */
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

test("what Luke kept in the workspace is read for it and listed in the service's order, each memory's words whole and named by whose they are, a press saying when it was kept, and kept out of the screen recording", async () => {
  const { page } = await mount();

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_READ)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }],
  );
  assert.match(
    page.textContent ?? "",
    /keep what you settle in Acme and recall it in later tasks/u,
  );
  assert.deepEqual(words(page), [DEPLOYS.text, TESTS.text]);
  const keeper = (memory: MemorySummary) =>
    rowOf(page, memory).querySelector(".luke-comment-head")?.textContent ?? "";
  assert.match(keeper(DEPLOYS), /^You/u);
  assert.match(keeper(TESTS), /^Dean/u);
  act(() => pressOf(page, DEPLOYS).click());
  assert.match(
    rowOf(page, DEPLOYS).textContent ?? "",
    /First kept\s*Oct 10, 2026.*Last kept\s*Oct 12, 2026, corrected or kept again/u,
  );
  assert.ok(
    rowOf(page, DEPLOYS).closest(".ph-no-capture"),
    "the rows are under the unrecorded class",
  );
});

test("a memory's code in backticks is drawn as inline code, never as the backticks themselves", async () => {
  const written = { ...TESTS, text: "Run `pnpm db:generate` after changing a schema." };
  stored = [written];
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
    dialog().querySelector('[data-slot="field-error"]:not(:empty)')?.textContent,
    "The memory could not be forgotten. Try again.",
  );
});

test("a private memory stands on the reader's own side, counted there, and its Forget says only the reader's agents lose it", async () => {
  stored = [{ ...DEPLOYS, private: true }, TESTS];
  const { page } = await mount();

  assert.deepEqual(sides(page), ["Acme1", "Only you1"]);
  assert.deepEqual(words(page), [TESTS.text]);
  showSide(page, "Only you");
  assert.deepEqual(words(page), [DEPLOYS.text]);
  askForget(page, DEPLOYS);
  assert.match(dialog().textContent ?? "", /Your Luke will not recall it again/u);
});

test("the search keeps the memories whose words or keeper hold it, and each side counts what it leaves there", async () => {
  const mine: MemorySummary = {
    ...DEPLOYS,
    id: "3d4e5f6a-7b8c-4d9e-8f0a-1b2c3d4e5f6a",
    text: "My previews deploy to Vercel's staging team.",
    private: true,
  };
  stored = [DEPLOYS, TESTS, mine];
  const { page } = await mount();

  await searchFor(page, "vercel");

  assert.deepEqual(sides(page), ["Acme1", "Only you1"]);
  assert.deepEqual(words(page), [DEPLOYS.text]);
  await searchFor(page, "dean");
  assert.deepEqual(sides(page), ["Acme1", "Only you0"]);
  assert.deepEqual(words(page), [TESTS.text]);
});

test("a memory whose member's account is gone says so once pressed", async () => {
  stored = [{ ...TESTS, keptBy: null }];
  const { page } = await mount();

  act(() => pressOf(page, TESTS).click());

  assert.match(rowOf(page, TESTS).textContent ?? "", /A former member, whose account was deleted/u);
});

test("a memory the reader may not forget offers Forget unavailable, saying who may", async () => {
  const { page } = await mount();

  openMenu(page, TESTS);

  assert.deepEqual(
    menuItems().find((item) => item.label === "Forget"),
    { label: "Forget", disabled: true },
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
  stored = [DEPLOYS, pricing, TESTS];
  const { page } = await mount();

  for (const memory of [DEPLOYS, pricing, TESTS]) {
    act(() => {
      pressOf(page, memory).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
      );
    });
  }
  act(() => button(page.querySelector('[role="toolbar"]') ?? page, "Forget").click());
  assert.match(
    dialog().textContent ?? "",
    /Forget 3 memories\?.*1 memory you may not forget stays\./u,
  );
  act(() => button(dialog(), "Forget").click());
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
  assert.deepEqual(words(page), [TESTS.text]);
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
  assert.match(page.textContent ?? "", /settle in Globex/u);
});

test("a forget answered after the page moved on to another workspace leaves that workspace's list as it read it", async () => {
  holdForgets = [];
  const { page, show } = await mount();
  await forget(page, DEPLOYS);
  stored = [];

  await show(GLOBEX);
  const release = holdForgets[0] ?? assert.fail("the forget was not sent");
  release(done({ memories: [TESTS] }));
  await settle();

  assert.deepEqual(words(page), []);
  assert.match(page.textContent ?? "", /settle in Globex/u);
});

test("a forget answered after the page left its workspace and came back reads that workspace again, so the forgotten memory is not left listed", async () => {
  holdForgets = [];
  const { page, show } = await mount();
  await forget(page, DEPLOYS);
  await show(GLOBEX);
  await show(ACME);
  const listedOnReturn = words(page);

  stored = [TESTS];
  const release = holdForgets[0] ?? assert.fail("the forget was not sent");
  release(done({ memories: stored }));
  await settle();

  assert.deepEqual(listedOnReturn, [DEPLOYS.text, TESTS.text]);
  assert.deepEqual(words(page), [TESTS.text]);
});

test("a read out while a later forget lands never puts back the memory that forget removed", async () => {
  const pricing: MemorySummary = {
    ...DEPLOYS,
    id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    text: "Pricing lives in the billing service.",
  };
  stored = [DEPLOYS, pricing, TESTS];
  holdForgets = [];
  const { page, show } = await mount();
  await forget(page, DEPLOYS);
  await show(GLOBEX);
  await show(ACME);
  // A second forget goes out before the first answers.
  await forget(page, pricing);
  const [releaseFirst, releaseSecond] = holdForgets;
  assert.ok(releaseFirst !== undefined && releaseSecond !== undefined);

  // The first forget lands after the round trip, so the page reads again, and that read is held.
  holdReads = [];
  releaseFirst(done({ memories: [pricing, TESTS] }));
  await settle();
  const releaseRead = holdReads[0] ?? assert.fail("the page did not read again");
  // The second forget lands while that read is out; the read had seen the list before it.
  stored = [TESTS];
  holdReads = undefined;
  releaseSecond(done({ memories: stored }));
  await settle();
  releaseRead(done({ memories: [pricing, TESTS] }));
  await settle();

  assert.deepEqual(words(page), [TESTS.text]);
});

test("another account signing in on the same workspace reads its memories again, as that reader may forget them", async () => {
  const { show } = await mount();

  await show(ACME, "user-dean");

  assert.deepEqual(
    sent
      .filter((request) => request.kind === ACT_KIND.MEMORIES_READ)
      .map((request) => request.payload),
    [{ workspaceId: ACME.id }, { workspaceId: ACME.id }],
  );
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
  assert.equal(signedOut.textContent, "Sign in to use this page.");
  assert.equal(
    sent.filter((request) => request.kind === ACT_KIND.MEMORIES_READ).length,
    2,
    "the signed-out page reads nothing",
  );
});

test("while the memories are read the page says Reading, which is neither its failure nor its empty line", async () => {
  holdReads = [];
  const { page } = await mount();

  const status = page.querySelector('[role="status"]') ?? assert.fail("no reading region");
  assert.equal(status.textContent, "Reading Luke's memory");
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

// @vitest-environment jsdom

import assert from "node:assert/strict";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { PLAN_ACTOR, type Task } from "@luke/features/task-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { useConfirmDialog } from "@luke/ui";
import { forgetPictures } from "@luke/ui/picture-cache";
import { ACTION_RESULT_STATUS, MESSAGE_ROLE } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { lineWords } from "#testing/actor-line";
import { fakeAppBridge } from "#testing/app-bridge";
import { onRegistry } from "#testing/copy-feedback";
import { DOCUMENT_TASK } from "#testing/document-task";
import { MarkdownMessage } from "../markdown-message";
import { AGENT_LEAD, AgentMessage } from "./agent-tab";
import { PlanBody } from "./plan-body";
import { HISTORY_READ } from "./use-plan-history";
import { VersionView } from "./version-view";

/**
 * plan-pictures.test.ts -- a plan's pictures where its words are drawn: each
 * read through the host and drawn from its bytes with its caption, one this
 * reader cannot reach drawn as its words, one from outside Luke a link that
 * reads nothing, a press opening the plan's pictures over the window, and a
 * version drawing a picture it struck and the one it wrote in, each marked,
 * and the plan's card in an agent's transcript drawing the plan's pictures.
 * Synthetic plans and pictures.
 */

/** A PNG's signature in base64: all the window draws of a picture here. */
const PNG_BASE64 = "iVBORw0KGgo=";

const MOCK = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const SECOND = "3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02";
const GONE = "d1e2f3a4-5b6c-4d7e-8f90-a1b2c3d4e506";

/** Who edits a plan here, as the service names a member. */
const LEE = { userId: "user-lee", name: "Lee Park" };

const HOUR = 60 * 60 * 1000;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The host as the window reaches it: the pictures it holds by id, those it cannot answer for now, and every other read refused. */
function standHost(
  pictures: ReadonlySet<string>,
  asked: string[],
  unanswered: ReadonlySet<string> = new Set(),
): void {
  fakeAppBridge({
    recordSurfaceEvent: () => undefined,
    act: (request: Act): Promise<ActOutcome> => {
      if (request.kind !== ACT_KIND.TASKS_PICTURE_READ) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." });
      }
      asked.push(request.payload.attachmentId);
      return Promise.resolve({
        status: ACT_OUTCOME_STATUS.DONE,
        value: pictures.has(request.payload.attachmentId)
          ? { contentType: "image/png", base64: PNG_BASE64 }
          : {
              failure: unanswered.has(request.payload.attachmentId) ? "unanswered" : "not-found",
            },
      });
    },
  });
}

async function drawn(element: ReactElement): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(onRegistry(AtomRegistry.make(), element)));
  await settle();
  return container;
}

/** A plan of its own id, so the window's pictures read for one test stand apart from another's. */
function taskOf(id: string, body: string): Task {
  return { ...DOCUMENT_TASK, id, document: { body, assumptions: [] } };
}

const picture = (planId: string, id: string) =>
  planAttachmentAddress({ taskId: planId, attachmentId: id }, "acme");

test("a plan's picture is drawn from its bytes under its caption, and one this reader cannot reach as its words", async () => {
  const planId = "7a1d4e90-0c3f-4b6a-9d2e-5f6a7b8c9d03";
  standHost(new Set([MOCK]), []);
  const body = [
    "## Approach",
    `![Invite email](${picture(planId, MOCK)} "The mock Lee shared")`,
    `![Members page](${picture(planId, GONE)})`,
  ].join("\n\n");

  const view = await drawn(createElement(PlanBody, { task: taskOf(planId, body), live: false }));

  const blocks = [...view.querySelectorAll<HTMLElement>(".picture-block")];
  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((block) => block.classList.contains("ph-no-capture")));
  const image = blocks[0]?.querySelector("img");
  assert.equal(image?.getAttribute("src"), `data:image/png;base64,${PNG_BASE64}`);
  assert.equal(image?.getAttribute("alt"), "Invite email");
  assert.equal(blocks[0]?.querySelector(".picture-caption")?.textContent, "The mock Lee shared");
  assert.equal(blocks[1]?.querySelector("img"), null);
  assert.equal(blocks[1]?.textContent, "Members page · not available");
});

test("a press on a picture opens the plan's pictures over the window, named by their alt text", async () => {
  const planId = "9e2f5c11-6d4a-4c8b-b1e3-2a3b4c5d6e04";
  standHost(new Set([MOCK, SECOND]), []);
  const body = [
    "## Approach",
    `![Invite email](${picture(planId, MOCK)})`,
    `![Members page](${picture(planId, SECOND)})`,
  ].join("\n\n");
  const view = await drawn(createElement(PlanBody, { task: taskOf(planId, body), live: false }));

  act(() => {
    view.querySelectorAll<HTMLButtonElement>(".picture-frame")[1]?.click();
  });

  const viewer = document.querySelector(".attachment-viewer");
  assert.ok(viewer, "the viewer stands over the window");
  assert.equal(viewer.querySelector(".attachment-viewer-title")?.textContent, "Members page");
  assert.equal(viewer.querySelector(".attachment-viewer-place")?.textContent, "2 of 2");
});

test("who last changed a picture's section is said in the viewer over the window, not over the picture in the words before the first heading", async () => {
  const planId = "5b8e2d40-7f1a-4e3c-9a6b-0c1d2e3f4a07";
  standHost(new Set([MOCK, SECOND]), []);
  const now = Date.now();
  const body = [
    `![Invite email](${picture(planId, MOCK)})`,
    `The members page's address is \`${picture(planId, SECOND)}\`, drawn under Approach.`,
    "## Approach",
    `![Members page](${picture(planId, SECOND)})`,
  ].join("\n\n");
  const plan: Task = {
    ...taskOf(planId, body),
    sectionEdits: [
      { section: "", actor: PLAN_ACTOR.DEVELOPER, by: LEE, at: now, duringCall: false },
      { section: "Approach", actor: PLAN_ACTOR.NOTETAKER, at: now - 2 * HOUR, duringCall: false },
    ],
  };
  const view = await drawn(createElement(PlanBody, { task: plan, live: false }));

  assert.deepEqual(
    [...view.querySelectorAll(".plan-unit-byline")].map((line) => lineWords(line)),
    ["Luke 2h"],
    "only the section with a heading carries its line in the words",
  );

  act(() => {
    view.querySelector<HTMLButtonElement>(".picture-frame")?.click();
  });
  const note = () => lineWords(document.querySelector(".attachment-viewer-note .actor-line"));
  assert.equal(note(), "Edited by Lee Park · now");

  act(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Next file"]')?.click();
  });
  assert.equal(
    note(),
    "Edited by Luke · 2h ago",
    "the next picture, by the section that draws it rather than one naming its address",
  );
});

test("a picture from outside Luke is a link to it, and nothing is read for it", async () => {
  const planId = "c4d5e6f7-1a2b-4c3d-8e9f-0a1b2c3d4e05";
  const asked: string[] = [];
  standHost(new Set(), asked);
  const body = "## Approach\n\nThe vendor's flow is ![SSO flow](https://northwind.io/sso.png).";

  const view = await drawn(createElement(PlanBody, { task: taskOf(planId, body), live: false }));

  assert.equal(view.querySelector("img"), null);
  assert.equal(view.querySelector(".text-link")?.textContent, "SSO flow");
  assert.deepEqual(asked, []);
});

test("words drawn with no picture drawer, as a reply is, keep a picture as its alt text", async () => {
  const view = await drawn(
    createElement(MarkdownMessage, {
      words: `![Invite email](${picture("7a1d4e90-0c3f-4b6a-9d2e-5f6a7b8c9d03", MOCK)})`,
    }),
  );

  assert.equal(view.querySelector("img"), null);
  assert.equal(view.textContent, "Invite email");
});

test("a version draws the picture it struck and the one it wrote in, each in its change's mark", async () => {
  const planId = "e2f3a4b5-6c7d-4e8f-90a1-b2c3d4e5f607";
  standHost(new Set([MOCK, SECOND]), []);
  const before = `## Approach\n\n![First mock](${picture(planId, MOCK)})\n`;
  const after = `## Approach\n\n![Second mock](${picture(planId, SECOND)})\n`;
  function Version(): React.JSX.Element {
    const restore = useConfirmDialog({ subject: true, surfaceOpen: true }, () =>
      Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
    );
    return createElement(VersionView, {
      viewing: {
        line: {
          seq: 2,
          lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 2, duringCall: false },
          startedAt: 1,
          changes: 1,
        },
        current: false,
        read: {
          kind: HISTORY_READ.READY,
          document: { body: after, assumptions: [] },
          previous: { body: before, assumptions: [] },
        },
      },
      restore,
      task: {
        taskId: planId,
        place: { workspace: "acme", repository: null },
        anchors: new Set<string>(),
      },
    });
  }

  const view = await drawn(createElement(Version));

  assert.equal(
    view.querySelector("del.markdown-deleted .picture-block img")?.getAttribute("alt"),
    "First mock",
  );
  assert.equal(
    view.querySelector("ins.markdown-inserted .picture-block img")?.getAttribute("alt"),
    "Second mock",
  );
});

test("another plan's picture is drawn as itself, with no press that would open nothing", async () => {
  const planId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const otherPlanId = "6f5e4d3c-2b1a-4c9d-8e7f-a0b1c2d3e4f5";
  standHost(new Set([MOCK]), []);
  const body = `## Approach\n\n![Copied mock](${picture(otherPlanId, MOCK)})`;

  const view = await drawn(createElement(PlanBody, { task: taskOf(planId, body), live: false }));

  assert.ok(view.querySelector(".picture-block img"));
  assert.equal(view.querySelector(".picture-block button"), null);
});

test("once the window lets go of its pictures, as an account change asks, each is read again as the account now signed in", async () => {
  const planId = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
  standHost(new Set([MOCK]), []);
  const body = `## Approach\n\n![Invite email](${picture(planId, MOCK)})`;
  const view = await drawn(createElement(PlanBody, { task: taskOf(planId, body), live: false }));
  assert.ok(view.querySelector(".picture-block img"));

  standHost(new Set(), []);
  act(() => forgetPictures());
  await settle();

  assert.equal(view.querySelector(".picture-block img"), null);
  assert.equal(view.querySelector(".picture-block")?.textContent, "Invite email · not available");
});

test("a picture whose read went unanswered says so alone, and the picture drawn in its place next is read", async () => {
  const planId = "3c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f";
  standHost(new Set([SECOND]), [], new Set([MOCK]));
  const first = `## Approach\n\n![First mock](${picture(planId, MOCK)})`;
  const view = await drawn(createElement(PlanBody, { task: taskOf(planId, first), live: false }));
  assert.equal(view.querySelector(".picture-block")?.textContent, "First mock · not available");

  // A plan drawn again asks the window whether motion is reduced, which a page with no layout cannot say.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  const next = `## Approach\n\n![Second mock](${picture(planId, SECOND)})`;
  act(() =>
    root?.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(PlanBody, { task: taskOf(planId, next), live: false }),
      ),
    ),
  );
  await settle();

  assert.equal(view.querySelector(".picture-block img")?.getAttribute("alt"), "Second mock");
});

test("an agent's plan card draws the plan's pictures once opened, while the agent's own words keep one a link", async () => {
  const planId = "5b8c2d34-7e1f-4a9b-8c6d-0e1f2a3b4c07";
  const asked: string[] = [];
  standHost(new Set([MOCK, SECOND]), asked);
  const address = picture(planId, MOCK);
  const plan = [
    "# Invites",
    `![Invite email](${address} "The mock Lee shared")`,
    "![Members page][members]",
    `[members]: ${picture(planId, SECOND)} "The page today"`,
  ].join("\n\n");
  const handed = { id: "plan", role: MESSAGE_ROLE.USER, parts: [{ type: "text", text: plan }] };
  const turn = {
    id: "turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "text", text: `Matched ![the mock](${address}).` }],
    startedAt: 1_000,
    finishedAt: 61_000,
  };
  const shared = { lead: AGENT_LEAD, moving: false, delegation: { models: [] } };
  const view = await drawn(
    createElement(
      Fragment,
      null,
      createElement(AgentMessage, { ...shared, message: handed, plan: true, planId }),
      createElement(AgentMessage, { ...shared, message: turn, plan: false }),
    ),
  );
  assert.deepEqual(asked, [], "a closed card reads nothing");

  act(() => view.querySelector<HTMLElement>("[data-task-card] > summary")?.click());
  await settle();

  const card = view.querySelector("[data-task-card]");
  const images = [...(card?.querySelectorAll(".picture-block img") ?? [])];
  assert.equal(images[0]?.getAttribute("src"), `data:image/png;base64,${PNG_BASE64}`);
  assert.deepEqual(
    images.map((image) => image.getAttribute("alt")),
    ["Invite email", "Members page"],
  );
  assert.deepEqual(
    [...(card?.querySelectorAll(".picture-caption") ?? [])].map((each) => each.textContent),
    ["The mock Lee shared", "The page today"],
    "a reference's caption is its definition's",
  );
  assert.deepEqual(asked, [MOCK, SECOND]);
  assert.equal(view.querySelectorAll("img").length, 2, "the agent's turn draws no picture");
  assert.match(view.textContent ?? "", /Matched the mock\./u);
});

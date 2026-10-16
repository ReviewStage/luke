// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { MESSAGE_ROLE } from "@luke/wire";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { newestToastAction, newestToastSays } from "#testing/toast";
import { ToastHost } from "../toast";
import { type AgentPictureDoor, AgentPicturesProvider } from "./agent-pictures";
import { AGENT_LEAD, AgentMessage } from "./agent-tab";
import { PlanMentions, type PlanMentionsValue } from "./plan-mentions";

/**
 * add-to-plan.test.ts -- a picture an agent showed, added to its plan from
 * the window's viewer: kept on the plan, its line written at the end of the
 * plan's text as the developer's edit, again on the text as it stands where
 * the plan moved on, said in the toast with Undo, which takes the line back
 * out; and offered only where the transcript stands on a plan's page.
 *
 * Synthetic plans and pictures throughout: the picture is a PNG's first
 * bytes, kept as they are, since they are under the plan's bound.
 */

const PLAN_ID = "4b1c2d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const KEPT_ID = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** The plan's text as the page last read it; the service's moves on under it where a test says. */
const PAGE_TEXT = "## Approach\n\nThe invite email follows the mock.\n";

/** The plan's text as the service holds it. */
let held = PAGE_TEXT;
let sent: Act[] = [];
const roots: Root[] = [];

beforeEach(() => {
  held = PAGE_TEXT;
  sent = [];
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (request: Act): Promise<ActOutcome> => {
        sent.push(request);
        if (request.kind === ACT_KIND.TASKS_PICTURE_KEEP) {
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { id: KEPT_ID } });
        }
        if (request.kind === ACT_KIND.TASKS_EDIT) {
          const { base, value } = request.payload.edit.document;
          if (base !== held) {
            return Promise.resolve({
              status: ACT_OUTCOME_STATUS.DONE,
              value: { conflict: { current: held } },
            });
          }
          held = value;
          return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: { saved: true } });
        }
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.UNKNOWN_ACT });
      },
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const PAGE: PlanMentionsValue = {
  planId: PLAN_ID,
  planName: "Invitations",
  workspace: "acme",
  repository: null,
  text: () => PAGE_TEXT,
  doors: {
    planId: PLAN_ID,
    place: { workspace: "acme", repository: null },
    anchors: new Set(["approach"]),
    onOpenPlan: () => undefined,
    onOpenFile: () => undefined,
  },
};

const DOOR: AgentPictureDoor = {
  owner: "agent-add-to-plan",
  read: () => Promise.resolve({ contentType: INBOX_IMAGE_TYPE.PNG, base64: PNG_BASE64 }),
};

const SHOWN: CodingAgentMessage = {
  id: "turn",
  role: MESSAGE_ROLE.ASSISTANT,
  parts: [
    {
      type: "tool-show_image",
      toolCallId: "call-show",
      state: "output-available",
      input: { images: [{ path: "shots/members.png", caption: "Members page" }] },
      output: {
        status: "accepted",
        pictures: [
          {
            id: "6f1c2a90-1b7e-4c3d-9a55-0d2e8b7c4f11",
            mediaType: "image/png",
            width: 1,
            height: 1,
            byteCount: 70,
          },
        ],
      },
    },
  ],
};

/** The agent's turn drawn with its pictures' door, on the plan's page where `page` is given. */
async function drawn(page: PlanMentionsValue | undefined) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const turn: ReactNode = createElement(
    AgentPicturesProvider,
    { value: DOOR },
    createElement(AgentMessage, {
      message: SHOWN,
      plan: false,
      lead: AGENT_LEAD,
      moving: true,
      delegation: { models: [] },
    }),
  );
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        page === undefined ? turn : createElement(PlanMentions, { value: page, children: turn }),
        createElement(ToastHost),
      ),
    ),
  );
  return container;
}

/** The viewer opened over the picture, by a press on it. */
async function opened(container: HTMLElement) {
  const picture = container.querySelector<HTMLButtonElement>(".picture-frame");
  assert.ok(picture, "the picture is drawn, its bytes read");
  await act(async () => picture.click());
}

/** Lets the press's reads land: the picture's bytes through the Mac's reader, then each act's answer, as the page waits on them. */
async function settled(done: () => boolean): Promise<void> {
  for (let tries = 0; tries < 40 && !done(); tries += 1) {
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function viewerButton(words: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>(".attachment-viewer button")].find(
    (button) => button.textContent === words,
  );
}

const LINE = `![Members page](https://tryluke.dev/acme/plan/${PLAN_ID}/files/${KEPT_ID})`;

test("Add to plan keeps the picture on the plan and writes its line at the plan's end, and Undo takes it back out", async () => {
  await opened(await drawn(PAGE));
  const add = viewerButton("Add to plan");
  assert.ok(add);

  await act(async () => add.click());
  await settled(() => newestToastSays() !== undefined);

  assert.deepEqual(
    sent.map((request) => request.kind),
    [ACT_KIND.TASKS_PICTURE_KEEP, ACT_KIND.TASKS_EDIT],
  );
  assert.equal(held, `${PAGE_TEXT}\n${LINE}\n`);
  assert.equal(newestToastSays(), "Added to the planUndo");

  const undo = newestToastAction();
  assert.ok(undo);
  await act(async () => undo.click());
  await settled(() => held === PAGE_TEXT && /Taken out/u.test(newestToastSays() ?? ""));

  assert.equal(held, PAGE_TEXT);
  assert.match(newestToastSays() ?? "", /Taken out of the plan/u);
});

test("a plan that moved on under the page is written on as it stands", async () => {
  held = `${PAGE_TEXT}\nA teammate's newer line.\n`;
  await opened(await drawn(PAGE));

  await act(async () => viewerButton("Add to plan")?.click());
  await settled(() => held.includes(LINE));

  assert.equal(held, `${PAGE_TEXT}\nA teammate's newer line.\n\n${LINE}\n`);
  assert.equal(sent.filter((request) => request.kind === ACT_KIND.TASKS_EDIT).length, 2);
});

test("a transcript off a plan's page offers no Add to plan", async () => {
  await opened(await drawn(undefined));

  assert.ok(document.querySelector(".attachment-viewer"), "the viewer opened");
  assert.equal(viewerButton("Add to plan"), undefined);
});

test("a planless agent's transcript, whose page names a workspace and no plan, offers no Add to plan", async () => {
  await opened(await drawn({ ...PAGE, planId: "", doors: { ...PAGE.doors, planId: "" } }));

  assert.ok(document.querySelector(".attachment-viewer"), "the viewer opened");
  assert.equal(viewerButton("Add to plan"), undefined);
});

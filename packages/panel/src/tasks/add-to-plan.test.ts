// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@luke/features/conversation-picture-wire";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import { PICTURE_KEEP_FAILURE, type TasksPictureKeepAnswer } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import type { PortActKind } from "@luke/host/contract";
import { MESSAGE_ROLE } from "@luke/wire";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AnyAct, fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { type AgentPictureDoor, AgentPicturesProvider } from "./agent-pictures.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";
import { TaskMentions, type TaskMentionsValue } from "./task-mentions.js";

/**
 * add-to-plan.test.ts -- a picture an agent showed, added to its plan from
 * the window's viewer: kept on the plan, its line written at the end of the
 * plan's text as the developer's edit, again on the text as it stands where
 * the plan moved on, said in a toast that stands from the press and turns
 * into Added with Undo once the line is written, which takes the line back
 * out; a recording kept as it is, within what a plan may be sent, and
 * refused in words past it or past the plan's videos; and offered only where
 * the transcript stands on a plan's page.
 *
 * Synthetic plans and pictures throughout: the picture is a PNG's first
 * bytes, kept as they are, since they are under the plan's bound.
 */

const TASK_ID = "4b1c2d3e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const KEPT_ID = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** The plan's text as the page last read it; the service's moves on under it where a test says. */
const PAGE_TEXT = "## Approach\n\nThe invite email follows the mock.\n";

/** A recording's first bytes, a WebM's, which is all the window reads of one. */
const WEBM_BASE64 = "GkXfow==";

/** The plan's text as the service holds it. */
let held = PAGE_TEXT;
/** Every picture the plan was sent to keep, as its `data:` URL. */
let keeping: string[] = [];
/** What a keep answers, a kept id unless a test says otherwise. */
let keepAnswer: TasksPictureKeepAnswer = { id: "" };
/** The kind of every act the plan was sent, whichever side carried it, in order. */
let sent: (AnyAct["kind"] | PortActKind)[] = [];
const roots: Root[] = [];

beforeEach(() => {
  held = PAGE_TEXT;
  sent = [];
  keeping = [];
  keepAnswer = { id: KEPT_ID };
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.TASKS_PICTURE_KEEP]: ({ picture }) => {
      sent.push(ACT_KIND.TASKS_PICTURE_KEEP);
      keeping.push(picture);
      return Promise.resolve(keepAnswer);
    },
    [ACT_KIND.TASKS_EDIT]: ({ edit }) => {
      sent.push(ACT_KIND.TASKS_EDIT);
      // The one edit this page sends is the document's whole text.
      assert.ok("document" in edit);
      const { base, value } = edit.document;
      if (base !== held) return Promise.resolve({ conflict: { current: held } });
      held = value;
      return Promise.resolve({ saved: true });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

const PAGE: TaskMentionsValue = {
  taskId: TASK_ID,
  taskName: "Invitations",
  workspace: "acme",
  repository: null,
  text: () => PAGE_TEXT,
  doors: {
    taskId: TASK_ID,
    place: { workspace: "acme", repository: null },
    anchors: new Set(["approach"]),
    onOpenTask: () => undefined,
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

/** A recording the agent showed, which its door answers as the bytes given. */
function recorded(base64: string): { shown: CodingAgentMessage; door: AgentPictureDoor } {
  const door: AgentPictureDoor = {
    owner: `agent-add-video-${String(base64.length)}`,
    read: () => Promise.resolve({ contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64 }),
  };
  const shown: CodingAgentMessage = {
    id: "turn-video",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      {
        type: "tool-show_image",
        toolCallId: "call-record",
        state: "output-available",
        input: { images: [{ path: "/tmp/video/flow.webm", caption: "Inviting a member" }] },
        output: {
          status: "accepted",
          pictures: [
            {
              id: "2d4f6a8c-0e1b-4d3f-8a5c-7e9b1d3f5a02",
              mediaType: CONVERSATION_MEDIA_TYPE.WEBM,
              width: 1280,
              height: 800,
              byteCount: base64.length,
            },
          ],
        },
      },
    ],
  };
  return { shown, door };
}

/** The agent's turn drawn with its pictures' door, on the plan's page where `page` is given. */
async function drawn(
  page: TaskMentionsValue | undefined,
  { shown, door }: { shown: CodingAgentMessage; door: AgentPictureDoor } = {
    shown: SHOWN,
    door: DOOR,
  },
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const turn: ReactNode = createElement(
    AgentPicturesProvider,
    { value: door },
    createElement(AgentMessage, {
      message: shown,
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
        page === undefined ? turn : createElement(TaskMentions, { value: page, children: turn }),
        createElement(ToastHost),
      ),
    ),
  );
  return container;
}

/** The viewer opened over the picture, by a press on it. */
async function opened(container: HTMLElement) {
  const picture = container.querySelector<HTMLButtonElement>(".picture-block button");
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

const LINE = `![Members page](https://tryluke.dev/acme/plan/${TASK_ID}/files/${KEPT_ID})`;

test("Add to plan keeps the picture on the plan and writes its line at the plan's end, and Undo takes it back out", async () => {
  await opened(await drawn(PAGE));
  const add = viewerButton("Add to plan");
  assert.ok(add);

  await act(async () => add.click());
  assert.equal(newestToastSays(), "Adding to the plan…");
  const card = document.querySelector(".luke-toast");
  await settled(() => /Added/u.test(newestToastSays() ?? ""));

  assert.deepEqual(sent, [ACT_KIND.TASKS_PICTURE_KEEP, ACT_KIND.TASKS_EDIT]);
  assert.equal(held, `${PAGE_TEXT}\n${LINE}\n`);
  assert.equal(newestToastSays(), "Added to the planUndo");
  assert.equal(
    document.querySelectorAll(".luke-toast").length,
    1,
    "the working toast turned in place",
  );
  assert.equal(document.querySelector(".luke-toast"), card);

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
  assert.equal(sent.filter((kind) => kind === ACT_KIND.TASKS_EDIT).length, 2);
});

test("a transcript off a plan's page offers no Add to plan", async () => {
  await opened(await drawn(undefined));

  assert.ok(document.querySelector(".attachment-viewer"), "the viewer opened");
  assert.equal(viewerButton("Add to plan"), undefined);
});

test("a planless agent's transcript, whose page names a workspace and no plan, offers no Add to plan", async () => {
  await opened(await drawn({ ...PAGE, taskId: "", doors: { ...PAGE.doors, taskId: "" } }));

  assert.ok(document.querySelector(".attachment-viewer"), "the viewer opened");
  assert.equal(viewerButton("Add to plan"), undefined);
});

/** Runs the body with the window's `blob:` addresses stood in, which jsdom makes none of. */
async function withBlobs(body: () => Promise<void>): Promise<void> {
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => "blob:recording";
  URL.revokeObjectURL = () => undefined;
  try {
    await body();
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
}

const VIDEO_LINE = `![Inviting a member](https://tryluke.dev/acme/plan/${TASK_ID}/files/${KEPT_ID})`;

test("Add to plan keeps a recording as it is, never re-encoded, and writes its line at the plan's end", () =>
  withBlobs(async () => {
    await opened(await drawn(PAGE, recorded(WEBM_BASE64)));
    const add = viewerButton("Add to plan");
    assert.ok(add, "the viewer playing the recording offers Add to plan");

    await act(async () => add.click());
    await settled(() => /Added/u.test(newestToastSays() ?? ""));

    assert.deepEqual(keeping, [`data:${CONVERSATION_MEDIA_TYPE.WEBM};base64,${WEBM_BASE64}`]);
    assert.equal(held, `${PAGE_TEXT}\n${VIDEO_LINE}\n`);
    assert.equal(newestToastSays(), "Added to the planUndo");
  }));

test("a recording past what a plan may be sent, or one past the plan's videos, is refused in words and the plan is not written", () =>
  withBlobs(async () => {
    // Three zero bytes for every four characters, one more than a sent video may hold.
    const large = "AAAA".repeat(1_100_001);
    await opened(await drawn(PAGE, recorded(large)));
    await act(async () => viewerButton("Add to plan")?.click());
    await settled(() => /over/u.test(newestToastSays() ?? ""));

    assert.deepEqual(sent, []);
    assert.equal(newestToastSays(), "This video is over 3.3 MB, more than a plan can be sent.");

    for (const root of roots.splice(0)) act(() => root.unmount());
    document.body.innerHTML = "";
    keepAnswer = { failure: PICTURE_KEEP_FAILURE.TOO_MANY_VIDEOS };
    await opened(await drawn(PAGE, recorded(WEBM_BASE64)));
    await act(async () => viewerButton("Add to plan")?.click());
    await settled(() => /videos/u.test(newestToastSays() ?? ""));

    assert.deepEqual(sent, [ACT_KIND.TASKS_PICTURE_KEEP]);
    assert.equal(held, PAGE_TEXT);
    assert.equal(newestToastSays(), "This plan already holds as many videos as it can.");
  }));

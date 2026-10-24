// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import {
  CONVERSATION_MEDIA_TYPE,
  PICTURE_OMISSION,
} from "@luke/features/conversation-picture-wire";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import type { PictureAnswer } from "@luke/ui/picture-cache";
import { MESSAGE_ROLE, type WireRecord, type WireValue } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  type AgentPictureDoor,
  AgentPicturesProvider,
  MessageFileChips,
} from "./agent-pictures.js";
import { AGENT_LEAD, AgentMessage } from "./agent-tab.js";

/**
 * agent-pictures.test.ts -- an agent's pictures in its transcript, drawn by
 * the agent's own turn: a set it showed stays out of the finished turn's
 * fold and reads each picture once through the door it is given; two calls
 * one after another are one set; an integration's call keeps its row and
 * gains its pictures as chips under it, one left out saying so; a refused
 * call is a row where its error is read; a picture written in the
 * agent's words is a link, never an image; a WebM it showed plays in a
 * player of its own, from a `blob:` address let go of as the player goes;
 * and an image a line handed the agent, which its row names by id, is read
 * through the door as a chip, while one a row keeps the bytes of is drawn
 * from them. A line still on its way draws its files going up, with no
 * share to read, and each takes its check as the line lands.
 *
 * Synthetic turns and pictures throughout: the door answers a PNG's first
 * bytes for every picture it is asked for.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

let minted = 0;

/** A picture as a stored output names it, its id fresh, so no test reads another's from the window's cache. */
function picture(width: number, height: number) {
  minted += 1;
  return {
    id: `0b7f3c11-8d2a-4e5f-9a61-${String(minted).padStart(12, "0")}`,
    mediaType: INBOX_IMAGE_TYPE.PNG,
    width,
    height,
    byteCount: 39_343,
  };
}

function toolPart(tool: string, callId: string, input: WireRecord, output?: WireValue): WireRecord {
  return {
    type: `tool-${tool}`,
    toolCallId: callId,
    state: output === undefined ? "input-available" : "output-available",
    input,
    ...(output === undefined ? undefined : { output }),
  };
}

function shown(callId: string, pictures: readonly ReturnType<typeof picture>[]): WireRecord {
  return toolPart(
    "show_image",
    callId,
    {
      images: pictures.map((_, at) => ({
        path: `shots/screen-${String(at)}.png`,
        caption: `Screen ${String(at + 1)}`,
      })),
    },
    { status: "accepted", pictures: [...pictures] },
  );
}

const text = (words: string): WireRecord => ({ type: "text", text: words });

function finished(parts: readonly WireRecord[]): CodingAgentMessage {
  return { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts, startedAt: 1_000, finishedAt: 61_000 };
}

/** The message drawn as an agent's turn is, under a door recording each picture it is asked to read. */
async function drawn(
  message: CodingAgentMessage,
  moving = false,
  answer: (id: string) => Promise<PictureAnswer> = () =>
    Promise.resolve({ contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw==" }),
) {
  const read: string[] = [];
  const door: AgentPictureDoor = {
    owner: "agent-7",
    read: (_owner, id) => {
      read.push(id);
      return answer(id);
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        AgentPicturesProvider,
        { value: door },
        createElement(AgentMessage, {
          message,
          plan: false,
          lead: AGENT_LEAD,
          moving,
          delegation: { models: [] },
        }),
      ),
    ),
  );
  return { container, read };
}

test("a set the agent showed stays out of the finished turn's fold, each picture read once and drawn at its own shape", async () => {
  const pictures = [picture(1200, 720), picture(390, 700)];
  const { container, read } = await drawn(
    finished([
      text("Pending invites now sit in the members list."),
      toolPart(
        "bash",
        "call-shot",
        { command: "pnpm exec playwright screenshot" },
        { exitCode: 0 },
      ),
      shown("call-show", pictures),
      text("Each invite says who sent it."),
    ]),
  );

  const tiles = [...container.querySelectorAll<HTMLElement>(".picture-set-tile")];
  assert.equal(tiles.length, 2, "the set is drawn though the work before it folded");
  assert.deepEqual(
    tiles.map((tile) => tile.querySelector(".picture-set-frame")?.getAttribute("style")),
    ["aspect-ratio: 1200 / 720;", "aspect-ratio: 390 / 700;"],
  );
  assert.deepEqual(
    [...container.querySelectorAll("img")].map((image) => image.getAttribute("src")),
    ["data:image/png;base64,iVBORw==", "data:image/png;base64,iVBORw=="],
  );
  assert.deepEqual(
    read,
    pictures.map((each) => each.id),
  );
  assert.match(
    container.textContent ?? "",
    /1 tool call/u,
    "the fold counts the command, not the set",
  );
});

test("two shown sets one after another are one set, and one picture alone is its own block", async () => {
  const [first, second, alone] = [picture(800, 450), picture(800, 450), picture(600, 520)];
  assert.ok(first && second && alone);
  const joined = await drawn(
    finished([shown("call-a", [first]), shown("call-b", [second]), text("Both.")]),
  );
  const single = await drawn(finished([shown("call-c", [alone]), text("One.")]));

  assert.equal(joined.container.querySelectorAll(".picture-set-tile").length, 2);
  assert.equal(joined.container.querySelectorAll(".picture-set").length, 1);
  assert.equal(single.container.querySelectorAll(".picture-block").length, 1);
  assert.equal(single.container.querySelector(".picture-caption")?.textContent, "Screen 1");
  const image = single.container.querySelector("img");
  assert.ok(image, "the picture is drawn");
  assert.notEqual(
    image.getAttribute("alt"),
    "Screen 1",
    "the caption is drawn once, not read again as the picture's own alt",
  );
});

test("an integration's call keeps its row and gains its pictures as chips, one left out saying so with its size", async () => {
  const kept = picture(390, 700);
  const answered = await drawn({
    id: "turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      toolPart("linear_remote", "call-linear", { remoteTool: "extract_images" }, [
        { type: "text", text: "2 images extracted" },
        { type: "image", mimeType: "image/png", picture: kept },
        {
          type: "image",
          mimeType: "image/png",
          omitted: PICTURE_OMISSION.TOO_LARGE,
          byteCount: 6_400_000,
        },
      ]),
    ],
  });
  const chips = [
    ...answered.container.querySelectorAll('ul[aria-label="Pictures the call answered"] > li'),
  ];
  assert.equal(chips.length, 2);
  assert.equal(chips[0]?.querySelector("img")?.getAttribute("alt"), "extract_images-1");
  assert.equal(chips[1]?.textContent, "Not kept6.4 MB");
});

test("a browser call's screenshots are thumbnails in a strip under its row, masked from the replay, and a press opens the window's viewer walking them", async () => {
  const [first, second] = [picture(1280, 800), picture(1280, 800)];
  assert.ok(first && second);
  const screenshot = (kept: ReturnType<typeof picture>) => ({
    action: "screenshot",
    status: "done",
    tab: "tab-1",
    image: { mime: "image/jpeg", width: 1280, height: 800 },
    picture: kept,
  });
  const { container, read } = await drawn({
    id: "turn",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      toolPart(
        "browser",
        "call-browser",
        {
          actions: [
            { action: "screenshot", tab: "tab-1" },
            { action: "click", tab: "tab-1", x: 40, y: 60 },
            { action: "screenshot", tab: "tab-1" },
          ],
        },
        {
          status: "ran",
          steps: [
            screenshot(first),
            { action: "click", status: "done", tab: "tab-1" },
            screenshot(second),
          ],
          skipped: 0,
          tabs: [{ tab: "tab-1", url: "http://localhost:3000/", title: "Shop" }],
        },
      ),
    ],
  });
  const strip = container.querySelector('ul[aria-label="Pictures the call answered"]');
  const thumbnails = [...(strip?.querySelectorAll("li img") ?? [])];

  assert.ok(strip?.classList.contains("ph-no-capture"), "the strip is left out of the replay");
  assert.deepEqual(
    thumbnails.map((image) => [image.getAttribute("alt"), image.getAttribute("src")]),
    [
      ["screenshot-1", "data:image/png;base64,iVBORw=="],
      ["screenshot-2", "data:image/png;base64,iVBORw=="],
    ],
  );
  assert.deepEqual(read, [first.id, second.id]);
  const open = strip?.querySelector<HTMLElement>("li button");
  assert.ok(open);

  await act(async () => open.click());

  assert.equal(document.querySelector(".attachment-viewer-place")?.textContent, "1 of 2");
});

test("a refused show_image is a row where its error is read, and a picture in the agent's words is a link, never an image", async () => {
  const { container } = await drawn(
    {
      id: "turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        {
          ...toolPart("show_image", "call-refused", {
            images: [{ path: "shots/full.png", caption: "Whole page" }],
          }),
          state: "output-error",
          errorText: "Not shown: a picture is kept up to 4 MB.",
        },
        text("Saved as ![Members page](shots/members.png) and ![](https://example.com/a.png)."),
      ],
    },
    true,
  );

  assert.match(container.textContent ?? "", /Showed\s*shots\/full\.png/u);
  assert.equal(container.querySelectorAll("img").length, 0);
  assert.match(container.textContent ?? "", /Saved as Members page and Picture\./u);
});

test("a refused set is a row that failed, its reason read in it, and nothing waits for pictures never kept", async () => {
  const reason = "Not shown: a picture is kept up to 4 MB. Save it smaller: shots/full.png";
  const { container } = await drawn(
    {
      id: "turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        toolPart(
          "show_image",
          "call-refused-answer",
          { images: [{ path: "shots/full.png", caption: "Whole page" }] },
          { status: "rejected", reason },
        ),
      ],
    },
    true,
  );

  assert.equal(container.querySelectorAll(".picture-block, .picture-set").length, 0);
  // The group the call stands in, then the call's own row, each opened as a reader would.
  for (let opened = 0; opened < 3; opened += 1) {
    const closed = container.querySelector<HTMLElement>("details:not([open]) > summary");
    if (closed === null) break;
    await act(async () => closed.click());
  }
  assert.match(container.textContent ?? "", /Not shown: a picture is kept up to 4 MB/u);
});

test("the viewer over a set of eight walks all eight, the two the turn did not draw among them", async () => {
  const pictures = Array.from({ length: 8 }, () => picture(800, 450));
  const { container } = await drawn(finished([shown("call-eight", pictures), text("All eight.")]));
  const first = container.querySelector<HTMLButtonElement>(".picture-set-tile button");
  assert.ok(first);

  await act(async () => first.click());

  assert.equal(document.querySelector(".attachment-viewer-place")?.textContent, "1 of 8");
});

test("a finished turn that ends on its pictures, with no words after them, keeps them out of its folded work", async () => {
  const { container } = await drawn(
    finished([
      toolPart("bash", "call-build-only", { command: "pnpm build" }, { exitCode: 0 }),
      toolPart(
        "bash",
        "call-shot-only",
        { command: "pnpm exec playwright screenshot" },
        { exitCode: 0 },
      ),
      shown("call-last", [picture(1200, 720), picture(390, 700)]),
    ]),
  );

  assert.equal(container.querySelectorAll(".picture-set-tile").length, 2);
  assert.match(container.textContent ?? "", /2 tool calls/u);
});

test("a set shown beside reasoning alone, with its words after, stands apart from the reasoning in a finished turn", async () => {
  const { container } = await drawn(
    finished([
      { type: "reasoning", text: "Show the page as it renders now." },
      shown("call-reasoned", [picture(1200, 720), picture(390, 700)]),
      text("Here it is."),
    ]),
  );

  assert.equal(container.querySelectorAll(".picture-set-tile").length, 2);
});

test("a set shown between calls stands on its own row, never in a group that folds once the agent moves on", async () => {
  const { container } = await drawn(
    {
      id: "turn",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        toolPart("bash", "call-before", { command: "pnpm build" }, { exitCode: 0 }),
        shown("call-between", [picture(1200, 720)]),
        toolPart("bash", "call-after", { command: "pnpm test" }, { exitCode: 0 }),
        text("Checking the tests next."),
      ],
      startedAt: 1_000,
    },
    true,
  );

  const block = container.querySelector(".picture-block");
  assert.ok(block, "the set is drawn");
  assert.equal(block.closest("[data-turn-fold]"), null);
});

test("a recording and a set shown after it stay out of every fold of the finished turn", async () => {
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  // Note that jsdom makes no object URLs, so the window's own are stood in for, and put back after.
  URL.createObjectURL = () => "blob:recording-2";
  URL.revokeObjectURL = () => undefined;
  try {
    const video = { ...picture(1278, 598), mediaType: CONVERSATION_MEDIA_TYPE.WEBM };
    const still = picture(1200, 720);
    const { container } = await drawn(
      finished([
        toolPart("bash", "call-serve", { command: "pnpm dev" }, { exitCode: 0 }),
        toolPart(
          "browser",
          "call-stop-shown",
          { actions: [{ action: "stop_recording", caption: "Opening a preview" }] },
          {
            status: "ran",
            steps: [
              {
                action: "stop_recording",
                status: "done",
                seconds: 25,
                caption: "Opening a preview",
                picture: video,
              },
            ],
            skipped: 0,
            tabs: [],
          },
        ),
        shown("call-shown-after", [still]),
        text("The preview opens from the header."),
      ]),
      false,
      (id) =>
        Promise.resolve(
          id === video.id
            ? { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: "GkXfow==" }
            : { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw==" },
        ),
    );

    const player = container.querySelector("video");
    const tile = container.querySelector(".picture-block img");
    assert.ok(player && tile, "both the recording and the set are drawn");
    assert.equal(player.closest("[data-turn-fold]"), null);
    assert.equal(tile.closest("[data-turn-fold]"), null);
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
});

test("the viewer opened on the first picture to land reaches the rest as their reads land", async () => {
  const pictures = [picture(800, 450), picture(800, 450), picture(800, 450)];
  const [first] = pictures;
  assert.ok(first);
  const held: (() => void)[] = [];
  const { container } = await drawn(
    finished([shown("call-staggered", pictures), text("Three.")]),
    false,
    (id) =>
      id === first.id
        ? Promise.resolve({ contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw==" })
        : new Promise((resolve) => {
            held.push(() => resolve({ contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw==" }));
          }),
  );
  const tile = container.querySelector<HTMLButtonElement>(".picture-set-tile button");
  assert.ok(tile);

  await act(async () => tile.click());
  assert.equal(
    document.querySelector(".attachment-viewer-place")?.textContent ?? "1 of 1",
    "1 of 1",
  );
  await act(async () => {
    for (const release of held) release();
  });

  assert.equal(document.querySelector(".attachment-viewer-place")?.textContent, "1 of 3");
});

test("a WebM the agent showed plays where it stands, above the picture shown with it, left out of the replay, and its Expand opens the viewer over both", async () => {
  const created: string[] = [];
  const revoked: string[] = [];
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  // Note that jsdom makes no object URLs, so the window's own are stood in for, and put back after.
  URL.createObjectURL = (blob: Blob) => {
    created.push(blob.type);
    return `blob:video-${String(created.length)}`;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  try {
    const video = { ...picture(1280, 800), mediaType: CONVERSATION_MEDIA_TYPE.WEBM };
    const still = picture(1200, 720);
    const { container, read } = await drawn(
      finished([
        toolPart(
          "show_image",
          "call-show",
          {
            images: [
              { path: "/tmp/video/flow.webm", caption: "Inviting a member" },
              { path: "shots/after.png", caption: "The invite sent" },
            ],
          },
          { status: "accepted", pictures: [video, still] },
        ),
        text("Invites can be sent from the members page."),
      ]),
      false,
      (id) =>
        Promise.resolve(
          id === video.id
            ? { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: "GkXfow==" }
            : { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw==" },
        ),
    );

    const inline = container.querySelector("video");
    assert.ok(inline, "the video plays where it stands");
    assert.equal(inline.getAttribute("src"), "blob:video-1");
    assert.deepEqual(
      [...(inline.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Expand", "Full screen"],
      "under Luke's own bar, with an Expand into the viewer",
    );
    assert.equal(inline.hasAttribute("controls"), false, "and not the browser's");
    assert.equal(inline.getAttribute("aria-label"), "Video: Inviting a member");
    assert.ok(inline.closest(".ph-no-capture"), "the player is left out of the replay");
    assert.deepEqual(
      [...container.querySelectorAll("img")].map((image) => image.getAttribute("src")),
      ["data:image/png;base64,iVBORw=="],
      "the picture shown with it is drawn as one picture alone is",
    );
    assert.deepEqual(read.sort(), [video.id, still.id].sort());

    act(() =>
      inline
        .closest(".picture-block")
        ?.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')
        ?.click(),
    );
    const player = document.querySelector('[role="dialog"] video');
    assert.ok(player, "its Expand opens the viewer, which plays the video");
    assert.deepEqual(
      [...(player.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Full screen"],
      "under Luke's own bar",
    );
    assert.equal(player.hasAttribute("controls"), false, "and not the browser's");
    assert.equal(player.getAttribute("aria-label"), "Video: Inviting a member.webm");
    assert.equal(document.querySelector(".attachment-viewer-place")?.textContent, "1 of 2");
    assert.deepEqual(created, [CONVERSATION_MEDIA_TYPE.WEBM, CONVERSATION_MEDIA_TYPE.WEBM]);

    const root = roots.pop();
    assert.ok(root);
    act(() => root.unmount());
    assert.deepEqual(
      revoked.sort(),
      ["blob:video-1", "blob:video-2"],
      "each address is let go of as its video goes",
    );
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
});

test("a call that shows a recording between two pictures draws it first, and the viewer walks the call as it is drawn", async () => {
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  // Note that jsdom makes no object URLs, so the window's own are stood in for, and put back after.
  URL.createObjectURL = () => "blob:interleaved-1";
  URL.revokeObjectURL = () => undefined;
  try {
    const before = picture(1200, 720);
    const video = { ...picture(1280, 800), mediaType: CONVERSATION_MEDIA_TYPE.WEBM };
    const after = picture(1200, 720);
    const { container } = await drawn(
      finished([
        toolPart(
          "show_image",
          "call-interleaved",
          {
            images: [
              { path: "shots/before.png", caption: "Before" },
              { path: "/tmp/video/flow.webm", caption: "The flow" },
              { path: "shots/after.png", caption: "After" },
            ],
          },
          { status: "accepted", pictures: [before, video, after] },
        ),
      ]),
      false,
      (id) =>
        Promise.resolve(
          id === video.id
            ? { contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: "GkXfow==" }
            : { contentType: INBOX_IMAGE_TYPE.PNG, base64: "iVBORw==" },
        ),
    );

    act(() =>
      container
        .querySelector("video")
        ?.closest(".picture-block")
        ?.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')
        ?.click(),
    );
    const shownNow = () => [
      document.querySelector('[role="dialog"] .attachment-viewer-title')?.textContent,
      document.querySelector('[role="dialog"] .attachment-viewer-place')?.textContent,
    ];
    const next = () =>
      act(() =>
        document
          .querySelector('[role="dialog"]')
          ?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
          ),
      );
    assert.deepEqual(shownNow(), ["The flow.webm", "1 of 3"]);
    act(() =>
      document
        .querySelector('[role="dialog"] input[aria-label="Seek"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
        ),
    );
    assert.deepEqual(
      shownNow(),
      ["The flow.webm", "1 of 3"],
      "an arrow on the recording's scrubber seeks it rather than walking on",
    );
    next();
    assert.deepEqual(shownNow(), ["Before.png", "2 of 3"]);
    next();
    assert.deepEqual(shownNow(), ["After.png", "3 of 3"]);
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
});

test("a recording a finished browser call kept plays under its row, out of the turn's fold, its caption under it, and its Expand opens the viewer", async () => {
  const own = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  // Note that jsdom makes no object URLs, so the window's own are stood in for, and put back after.
  URL.createObjectURL = () => "blob:recording-1";
  URL.revokeObjectURL = () => undefined;
  try {
    const video = { ...picture(1278, 598), mediaType: CONVERSATION_MEDIA_TYPE.WEBM };
    const { container, read } = await drawn(
      finished([
        toolPart(
          "browser",
          "call-record",
          { actions: [{ action: "record" }] },
          {
            status: "ran",
            steps: [{ action: "record", status: "done", maxSeconds: 120 }],
            skipped: 0,
            tabs: [],
          },
        ),
        toolPart(
          "browser",
          "call-stop",
          { actions: [{ action: "stop_recording", caption: "Inviting a member" }] },
          {
            status: "ran",
            steps: [
              {
                action: "stop_recording",
                status: "done",
                seconds: 8.3,
                caption: "Inviting a member",
                picture: video,
              },
            ],
            skipped: 0,
            tabs: [],
          },
        ),
        text("Invites can be sent from the members page."),
      ]),
      false,
      () => Promise.resolve({ contentType: CONVERSATION_MEDIA_TYPE.WEBM, base64: "GkXfow==" }),
    );

    const inline = container.querySelector("video");
    assert.ok(inline, "the recording plays though the work before it folded");
    assert.equal(inline.getAttribute("src"), "blob:recording-1");
    assert.deepEqual(
      [...(inline.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Expand", "Full screen"],
      "under Luke's own bar, with an Expand into the viewer",
    );
    assert.equal(inline.hasAttribute("controls"), false, "and not the browser's");
    assert.ok(inline.closest(".ph-no-capture"));
    assert.equal(
      inline.closest(".picture-block")?.querySelector(".picture-caption")?.textContent,
      "Inviting a member",
    );
    assert.deepEqual(read, [video.id]);

    act(() =>
      inline
        .closest(".picture-block")
        ?.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')
        ?.click(),
    );
    const player = document.querySelector('[role="dialog"] video');
    assert.ok(player, "its Expand opens the viewer, which plays the recording");
    assert.deepEqual(
      [...(player.closest(".luke-video-player")?.querySelectorAll("button") ?? [])].map((each) =>
        each.getAttribute("aria-label"),
      ),
      ["Play", "Full screen"],
      "under Luke's own bar",
    );
    assert.equal(player.hasAttribute("controls"), false, "and not the browser's");
  } finally {
    URL.createObjectURL = own.create;
    URL.revokeObjectURL = own.revoke;
  }
});

test("an image a line's row names by the picture it was kept as is read through the door and drawn as its chip, and one an older row keeps the bytes of is drawn from them with no read", async () => {
  const kept = picture(2, 1);
  const { container, read } = await drawn({
    id: "line",
    role: MESSAGE_ROLE.USER,
    parts: [
      text("Match these."),
      {
        type: "file",
        mediaType: INBOX_IMAGE_TYPE.PNG,
        filename: "flow.png",
        url: "",
        providerMetadata: { luke: { attachmentId: kept.id } },
      },
      {
        type: "file",
        mediaType: INBOX_IMAGE_TYPE.PNG,
        filename: "old.png",
        url: "data:image/png;base64,AAAA",
      },
    ],
  });

  const chips = [...container.querySelectorAll('ul[aria-label="Attached files"] > li')];
  assert.deepEqual(
    chips.map((chip) => chip.querySelector("img")?.getAttribute("src")),
    ["data:image/png;base64,iVBORw==", "data:image/png;base64,AAAA"],
  );
  assert.deepEqual(read, [kept.id]);
});

test("a line still on its way draws its files going up with no share, each taking its check as the line lands", () => {
  const message: CodingAgentMessage = {
    id: "line-1",
    role: MESSAGE_ROLE.USER,
    parts: [
      { type: "text", text: "Here's the spec" },
      {
        type: "file",
        mediaType: "application/pdf",
        filename: "spec.pdf",
        url: "data:application/pdf;base64,JVBERi0=",
      },
    ],
  };
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  const draw = (sending: boolean) =>
    act(() => root.render(createElement(MessageFileChips, { message, sending })));
  draw(true);
  const meter = host.querySelector('[role="progressbar"]') ?? assert.fail("a file going up");
  assert.equal(meter.getAttribute("aria-label"), "Uploading spec.pdf");
  assert.equal(meter.hasAttribute("aria-valuenow"), false, "the send says nothing of its share");
  draw(false);
  assert.equal(host.querySelector('[role="progressbar"]'), null);
  assert.notEqual(host.querySelector(".luke-attachment-chip-landed"), null, "its check");
});

// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentMessage } from "@luke/features/coding-agent-wire";
import { PICTURE_OMISSION } from "@luke/features/conversation-picture-wire";
import { INBOX_IMAGE_TYPE } from "@luke/features/inbox-wire";
import type { PictureAnswer } from "@luke/ui/picture-cache";
import { MESSAGE_ROLE, type WireRecord, type WireValue } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type AgentPictureDoor, AgentPicturesProvider } from "./agent-pictures";
import { AGENT_LEAD, AgentMessage } from "./agent-tab";

/**
 * agent-pictures.test.ts -- an agent's pictures in its transcript, drawn by
 * the agent's own turn: a set it showed stays out of the finished turn's
 * fold and reads each picture once through the door it is given; two calls
 * one after another are one set; an integration's call keeps its row and
 * gains its pictures as chips under it, one left out saying so; a refused
 * call is a row where its error is read; and a picture written in the
 * agent's words is a link, never an image.
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
  const chips = [...answered.container.querySelectorAll(".call-picture")];
  assert.equal(chips.length, 2);
  assert.equal(chips[0]?.querySelector("img")?.getAttribute("alt"), "extract_images-1");
  assert.equal(chips[1]?.textContent, "Not kept6.4 MB");
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
  const first = container.querySelector<HTMLButtonElement>(".picture-set-tile");
  assert.ok(first);

  await act(async () => first.click());

  assert.equal(document.querySelector(".attachment-viewer-place")?.textContent, "1 of 8");
});

test("a finished turn that ends on its pictures, with no words after them, keeps them out of its folded work", async () => {
  const { container } = await drawn(
    finished([
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
  assert.match(container.textContent ?? "", /1 tool call/u);
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
  const tile = container.querySelector<HTMLButtonElement>(".picture-set-tile");
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

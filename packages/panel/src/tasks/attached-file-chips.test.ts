// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { lineFileUrl } from "@luke/features/line-file-wire";
import { forgetPictures, type PictureAnswer } from "@luke/ui/picture-cache";
import { MESSAGE_ROLE } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type AgentPictureDoor, AgentPicturesProvider } from "./agent-pictures.js";
import { SentFileChips } from "./attached-file-chips.js";

/**
 * attached-file-chips.test.ts -- the files over a developer's row draw the
 * same whether the row carries them inline, as rows written before the
 * service kept them did, or names the row the service kept each as, read
 * through the agent's picture door; a file the door answers nothing for is
 * drawn by its name alone. Synthetic bytes and ids.
 */

const KEPT_ID = "0b6f1c3e-2d4a-4e5b-8c7d-9e0f1a2b3c4d";

/** A picture's signature and a mark, as base64. */
const SHOT = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]).toString("base64");

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  forgetPictures();
});

/** A developer's row carrying one picture under the URL given. */
function rowWith(url: string) {
  return {
    id: "row-1",
    role: MESSAGE_ROLE.USER,
    parts: [
      { type: "text", text: "Look at this." },
      { type: "file", mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG, filename: "flow.png", url },
    ],
  };
}

/** A door whose read answers what is given, under one agent. */
function door(answer: PictureAnswer): AgentPictureDoor {
  return { owner: "agent-1", read: () => Promise.resolve(answer) };
}

/** Each chip as a reader sees it: its name, its state, its thumbnail, and its words. */
function chipsOf(host: HTMLElement): readonly (string | null)[][] {
  return Array.from(host.querySelectorAll("li"), (chip) => [
    chip.getAttribute("title"),
    chip.getAttribute("data-state"),
    chip.getAttribute("data-image"),
    chip.querySelector("img")?.getAttribute("src") ?? null,
    chip.textContent,
  ]);
}

async function drawn(
  url: string,
  through: AgentPictureDoor,
): Promise<readonly (string | null)[][]> {
  const host = document.createElement("div");
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      createElement(
        AgentPicturesProvider,
        { value: through },
        createElement(SentFileChips, { message: rowWith(url) }),
      ),
    ),
  );
  return chipsOf(host);
}

test("a row naming its kept file draws the same chip as a row carrying it inline", async () => {
  const reader = door({ contentType: CODING_AGENT_ATTACHMENT_TYPE.PNG, base64: SHOT });

  const inline = await drawn(`data:${CODING_AGENT_ATTACHMENT_TYPE.PNG};base64,${SHOT}`, reader);
  const kept = await drawn(lineFileUrl(KEPT_ID), reader);

  assert.equal(inline[0]?.[3], `data:${CODING_AGENT_ATTACHMENT_TYPE.PNG};base64,${SHOT}`);
  assert.deepEqual(kept, inline);
});

test("a kept file the door answers nothing for is drawn by its name alone", async () => {
  const kept = await drawn(lineFileUrl(KEPT_ID), door({ failure: "not-found" }));

  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.[0], "flow.png");
  assert.equal(kept[0]?.[3], null, "no thumbnail");
});

test("rows naming the same kept file share one read", async () => {
  let reads = 0;
  const counting: AgentPictureDoor = {
    owner: "agent-1",
    read: () => {
      reads += 1;
      return Promise.resolve({ contentType: CODING_AGENT_ATTACHMENT_TYPE.PNG, base64: SHOT });
    },
  };
  const host = document.createElement("div");
  const root = createRoot(host);
  roots.push(root);
  const row = rowWith(lineFileUrl(KEPT_ID));

  await act(async () =>
    root.render(
      createElement(
        AgentPicturesProvider,
        { value: counting },
        createElement(SentFileChips, { message: row }),
        createElement(SentFileChips, { message: { ...row, id: "row-2" } }),
      ),
    ),
  );

  assert.equal(reads, 1);
  assert.equal(chipsOf(host).length, 2);
});

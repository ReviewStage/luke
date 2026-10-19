// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { type RowMediaReads, useRowMediaReads } from "./inbox-row-media.js";

/**
 * inbox-row-media.test.ts -- the window Inbox's reads of its rows' pictures
 * hold a picture while a listed item's row draws it, and let it go once its
 * item leaves the list or is reposted without it, a read still out for it
 * landing nowhere; a picture asked for again once its item is listed again
 * is read again. Synthetic items and attachments.
 */

const ITEM_A = "a1b2c3d4-0000-4000-8000-00000000000a";
const ITEM_B = "a1b2c3d4-0000-4000-8000-00000000000b";
const PICTURE_A = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c7a";
const PICTURE_B = "5e8d2c1a-7b3f-4a6e-9c2d-1f4b6a8e3c7b";

/** Each picture's bytes as the service answers them, by attachment. */
const BYTES = new Map([
  [PICTURE_A, "iVBORw0KGgoA"],
  [PICTURE_B, "iVBORw0KGgoB"],
]);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

/** The hook over the items listed, every picture read held until the test answers it; and how to list others. */
function reads(first: readonly string[]) {
  const out = new Map<string, () => Promise<void>>();
  fakeAppBridge({
    act: (request: Act) =>
      new Promise<ActOutcome>((resolve) => {
        if (request.kind !== ACT_KIND.CODING_AGENTS_INBOX_ATTACHMENT) return;
        const { attachmentId } = request.payload;
        out.set(attachmentId, async () => {
          await act(async () => {
            resolve({
              status: ACT_OUTCOME_STATUS.DONE,
              value: { contentType: "image/png", base64: BYTES.get(attachmentId) ?? "" },
            });
            for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
          });
        });
      }),
  });
  let held: RowMediaReads | undefined;
  function Harness({ listed }: { listed: readonly string[] }) {
    held = useRowMediaReads(listed);
    return null;
  }
  root = createRoot(document.createElement("div"));
  const registry = AtomRegistry.make();
  const list = (listed: readonly string[]) =>
    act(() => root?.render(onRegistry(registry, createElement(Harness, { listed }))));
  list(first);
  const hook = () => held ?? assert.fail("the hook stands");
  return {
    list,
    /** A row says which pictures its item carries now. */
    draw: (itemId: string, attachmentIds: readonly string[]) =>
      act(() => hook().onImages(itemId, attachmentIds)),
    /** Answers the read out for a picture. */
    answer: (attachmentId: string) =>
      (out.get(attachmentId) ?? assert.fail(`a read is out for ${attachmentId}`))(),
    /** The picture held under an attachment, as a row draws it. */
    image: (attachmentId: string) => {
      const image = hook().images.get(attachmentId);
      return image === undefined || "failed" in image ? image : image.url;
    },
  };
}

test("a picture is held while its item is listed and let go once the item leaves the list, the rest kept", async () => {
  const hook = reads([ITEM_A, ITEM_B]);
  hook.draw(ITEM_A, [PICTURE_A]);
  hook.draw(ITEM_B, [PICTURE_B]);
  await hook.answer(PICTURE_A);
  await hook.answer(PICTURE_B);
  assert.equal(hook.image(PICTURE_A), "data:image/png;base64,iVBORw0KGgoA");
  assert.equal(hook.image(PICTURE_B), "data:image/png;base64,iVBORw0KGgoB");
  hook.list([ITEM_B]);
  assert.equal(hook.image(PICTURE_A), undefined, "the item that left takes its picture with it");
  assert.equal(hook.image(PICTURE_B), "data:image/png;base64,iVBORw0KGgoB");
  hook.list([]);
  assert.equal(hook.image(PICTURE_B), undefined, "a list showing no media holds none");
});

test("a read still out when its item leaves lands nowhere, and the picture is read again once its item is listed and asks again", async () => {
  const hook = reads([ITEM_A]);
  hook.draw(ITEM_A, [PICTURE_A]);
  hook.list([]);
  await hook.answer(PICTURE_A);
  assert.equal(hook.image(PICTURE_A), undefined, "the late answer holds nothing");
  hook.list([ITEM_A]);
  hook.draw(ITEM_A, [PICTURE_A]);
  await hook.answer(PICTURE_A);
  assert.equal(hook.image(PICTURE_A), "data:image/png;base64,iVBORw0KGgoA");
});

test("an item reposted with other pictures, still listed, lets go of the one it no longer carries", async () => {
  const hook = reads([ITEM_A]);
  hook.draw(ITEM_A, [PICTURE_A]);
  await hook.answer(PICTURE_A);
  assert.equal(hook.image(PICTURE_A), "data:image/png;base64,iVBORw0KGgoA");
  hook.draw(ITEM_A, [PICTURE_B]);
  await hook.answer(PICTURE_B);
  assert.equal(hook.image(PICTURE_A), undefined, "the old version's picture goes with it");
  assert.equal(hook.image(PICTURE_B), "data:image/png;base64,iVBORw0KGgoB");
});

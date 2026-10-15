// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import type { PictureTaken, PlanEditorHandle, PlanEditorPictures } from "./contract";
import { mountPlanEditor } from "./plan-editor";

/**
 * A plan's pictures in its editor: a file pasted or chosen is laid in as a
 * picture after the caret's block, handed to the panel under its upload,
 * and writes nothing until the panel kept it, then its line; Remove takes
 * one still being kept out; and a picture of another plan pasted in is kept
 * again on this one. Synthetic plan and pictures.
 */

const PLAN_ID = "5d8e2a61-7c3b-4f0e-9b1a-2c6d4e8f0a13";
const OTHER_PLAN_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const KEPT = `https://tryluke.dev/acme/plan/${PLAN_ID}/files/0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01`;
const OTHERS = `https://tryluke.dev/acme/plan/${OTHER_PLAN_ID}/files/3c9e1a77-58b2-4d0f-8e6a-1b2c3d4e5f02`;

const TEXT = "## Approach\n\nThe invite email follows the mock.\n\n## Decisions\n\nSingle use.\n";

const handles: PlanEditorHandle[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.innerHTML = "";
});

/** The editor on `TEXT`, its caret at the end of the Approach section, with the panel's pictures stood in for. */
function opened(markdown = TEXT) {
  const taken: PictureTaken[] = [];
  const pictures: PlanEditorPictures = {
    draw: () => ({ redraw: () => undefined, undraw: () => undefined }),
    take: (each) => taken.push(...each),
    copies: (src) => src.includes(OTHER_PLAN_ID),
  };
  const host = document.body.appendChild(document.createElement("div"));
  const handle = mountPlanEditor(host, {
    markdown,
    placement: { section: 0 },
    focus: false,
    label: "Plan",
    className: "markdown plan-unit",
    onDraft: () => undefined,
    onFinish: () => undefined,
    onLeaveUp: () => undefined,
    pictures,
  });
  handles.push(handle);
  return { handle, taken, host };
}

const PNG = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "members.png", { type: "image/png" });

test("a picture laid in writes nothing while it is kept, then its line under the caret's section, named for its file", () => {
  const { handle, taken } = opened();

  handle.insertPictures([PNG()]);
  const meanwhile = handle.markdown();
  const [laid] = taken;
  assert.ok(laid !== undefined && "file" in laid);
  handle.settlePicture(laid.upload, KEPT);

  assert.equal(meanwhile, TEXT);
  assert.equal(
    handle.markdown(),
    TEXT.replace("follows the mock.\n", `follows the mock.\n\n![members](${KEPT})\n`),
  );
});

test("Remove takes a picture still being kept out of the text, leaving it as it was", () => {
  const { handle, taken } = opened();
  handle.insertPictures([PNG()]);

  handle.removePicture(taken[0]?.upload ?? "");
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(handle.markdown(), TEXT);
});

test("image files pasted are laid in as pictures, and a pasted screenshot is called one", () => {
  const { handle, taken, host } = opened();
  const editable = host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const screenshot = new File([new Uint8Array([1])], "image.png", { type: "image/png" });
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(paste, "clipboardData", {
    value: { files: [screenshot], types: ["Files"], getData: () => "" },
  });

  editable.dispatchEvent(paste);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(taken.length, 1);
  assert.ok(handle.markdown().includes(`![Screenshot](${KEPT})`));
});

test("a picture of another plan pasted in is kept again on this one, and one of this plan's is pasted as it is", () => {
  const { handle, taken, host } = opened();
  const editable = host.querySelector(".ProseMirror") ?? assert.fail("the editor stands");
  const paste = new Event("paste", { bubbles: true, cancelable: true });
  const html = `<p><img src="${OTHERS}" alt="Old mock"></p><p><img src="${KEPT}" alt="The mock"></p>`;
  Object.defineProperty(paste, "clipboardData", {
    value: {
      files: [],
      types: ["text/html"],
      getData: (type: string) => (type === "text/html" ? html : ""),
    },
  });

  editable.dispatchEvent(paste);

  assert.deepEqual(
    taken.map((each) => ("from" in each ? each.from : undefined)),
    [OTHERS],
  );
  assert.ok(handle.markdown().includes(`![The mock](${KEPT})`));
  assert.equal(handle.markdown().includes(OTHER_PLAN_ID), false);
});

test("a picture laid in after the text's last block stands apart from it by a blank line", () => {
  const { handle, taken } = opened("## Approach\n\nThe invite email follows the mock.\n");

  handle.insertPictures([PNG()]);
  handle.settlePicture(taken[0]?.upload ?? "", KEPT);

  assert.equal(
    handle.markdown(),
    `## Approach\n\nThe invite email follows the mock.\n\n![members](${KEPT})\n`,
  );
});

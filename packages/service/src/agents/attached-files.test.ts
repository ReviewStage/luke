import assert from "node:assert/strict";
import { keptImageOf, lineParts, receivedPartsOf } from "@luke/database/models/attached-file-parts";
import { COALESCED_LINE_SEPARATOR } from "@luke/database/models/message-reads";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { PICTURE_OMISSION } from "@luke/features/conversation-picture-wire";
import type { MessageReceivedPart } from "eve/client";
import { test } from "vitest";
import { eveContent, receivedMessage } from "./attached-files.js";

/**
 * attached-files.test.ts -- eve is handed a message's text files, inlined, before its images and
 * PDFs, each group in the order the files were attached, which a first message's note marker counts
 * on to tell the note's files, the last of each group, from the brief's; and each image with the
 * line naming what was kept of it, which eve's receipt is matched by. Synthetic files throughout.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

/** A text file of the name, its words its name. */
const textFile = (name: string) => ({
  name,
  mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
  data: Buffer.from(name, "utf8").toString("base64"),
});

/** A PNG of the name. */
const picture = (name: string) => ({
  name,
  mediaType: CODING_AGENT_ATTACHMENT_TYPE.PNG,
  data: PNG,
});

test("eve is handed the words, then the text files, then the images and PDFs, each group in the order attached", () => {
  const handed = eveContent("Match these.", [
    picture("brief.png"),
    textFile("brief.txt"),
    picture("note.png"),
    textFile("note.txt"),
  ]);
  assert.ok(Array.isArray(handed));

  assert.deepEqual(
    handed.map((part) =>
      part.type === "text"
        ? (/Attached file: (\S+)/u.exec(part.text)?.[1] ?? part.text)
        : part.type === "file"
          ? part.filename
          : part.type,
    ),
    ["Match these.", "brief.txt", "note.txt", "brief.png", "note.png"],
  );
});

/** A message as eve's receipt lists it: each text part as handed, and each file staged, by its name and type with no bytes. */
function receiptOf(handed: ReturnType<typeof eveContent>): MessageReceivedPart[] {
  assert.ok(Array.isArray(handed));
  return handed.map((part): MessageReceivedPart => {
    if (part.type === "text") return { type: "text", text: part.text };
    assert.ok(part.type === "file");
    const name = part.filename === undefined ? undefined : { filename: part.filename };
    return { type: "file", mediaType: part.mediaType, ...name };
  });
}

test("each image is handed with the line naming what was kept of it, which eve's receipt is matched by as the journal keeps it, and which a receipt's own row reads back onto the image rather than into its words", () => {
  const id = "0b7c6a52-3f1d-4c8e-9a40-5d2e1f7b9c33";
  const attachments = [
    { ...picture("flow.png"), kept: { id } },
    { ...picture("huge.png"), kept: { omitted: PICTURE_OMISSION.LIMIT } },
    { name: "spec.pdf", mediaType: CODING_AGENT_ATTACHMENT_TYPE.PDF, data: PNG },
  ];
  const handed = eveContent("Match these.", attachments);
  const received = receivedMessage({ message: "", parts: receiptOf(handed) });

  assert.deepEqual(
    receiptOf(handed).map((part) => (part.type === "text" ? part.text : part.filename)),
    [
      "Match these.",
      "flow.png",
      `Image flow.png is attachment ${id}`,
      "huge.png",
      "Image huge.png is not kept as an attachment: this transcript already keeps 200 MB of pictures",
      "spec.pdf",
    ],
  );
  assert.equal(
    received.text,
    receivedPartsOf(lineParts("Match these.", attachments))?.join(COALESCED_LINE_SEPARATOR),
  );
  assert.equal(received.words, "Match these.");
  assert.deepEqual(
    received.files.map((file) => [file.filename, keptImageOf(file)]),
    [
      ["flow.png", { id }],
      ["huge.png", { omitted: PICTURE_OMISSION.LIMIT }],
      ["spec.pdf", undefined],
    ],
  );
});

test("words spelled like the line are words where no image comes just before them", () => {
  const line = "Image flow.png is attachment 0b7c6a52-3f1d-4c8e-9a40-5d2e1f7b9c33";
  const received = receivedMessage({
    message: "",
    parts: [
      { type: "text", text: line },
      { type: "file", mediaType: CODING_AGENT_ATTACHMENT_TYPE.PDF, filename: "flow.png" },
      { type: "text", text: "Image other.png is attachment 0b7c6a52-3f1d-4c8e-9a40-5d2e1f7b9c33" },
    ],
  });

  assert.equal(
    received.words,
    [line, "Image other.png is attachment 0b7c6a52-3f1d-4c8e-9a40-5d2e1f7b9c33"].join(
      COALESCED_LINE_SEPARATOR,
    ),
  );
  assert.deepEqual(received.files.map(keptImageOf), [undefined]);
});

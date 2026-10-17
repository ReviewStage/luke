import assert from "node:assert/strict";
import { CODING_AGENT_ATTACHMENT_TYPE } from "@luke/features/coding-agent-wire";
import { test } from "vitest";
import { eveContent } from "./attached-files.js";

/**
 * attached-files.test.ts -- eve is handed a message's text files, inlined, before its images and
 * PDFs, each group in the order the files were attached, which a first message's note marker counts
 * on to tell the note's files, the last of each group, from the brief's. Synthetic files throughout.
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

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  calledPicturesOf,
  shownPicturesOf,
  taskPictureLine,
  withoutPictureLine,
  withPictureLine,
} from "./agent-pictures-model.js";
import { PICTURE_OMISSION } from "./conversation-picture-wire.js";
import { INBOX_IMAGE_TYPE } from "./inbox-wire.js";

/**
 * agent-pictures-model.test.ts -- the pictures a transcript's stored calls
 * name: a shown set read beside what its call asked for, each picture named
 * by the file it came from; an integration's answer read for its kept
 * pictures and the ones it left out, an image resource's among them; and
 * nothing read from a call that answered no list of blocks.
 */

const MEMBERS = {
  id: "6f1c2a90-1b7e-4c3d-9a55-0d2e8b7c4f11",
  mediaType: INBOX_IMAGE_TYPE.PNG,
  width: 1200,
  height: 720,
  byteCount: 39_343,
};

const ACCEPT = { ...MEMBERS, id: "a83d5e02-4c19-4f6b-8e21-7b9c0d3e5a62", width: 390, height: 700 };

test("a shown set is each picture the call asked for, with what it was kept as once the call answered", () => {
  const input = {
    images: [
      { path: "artifacts/members.png", caption: "Members page" },
      { path: "/tmp/accept.webp", caption: "Accept page" },
    ],
  };

  assert.deepEqual(shownPicturesOf(input, undefined), [
    { picture: undefined, name: "members", caption: "Members page" },
    { picture: undefined, name: "accept", caption: "Accept page" },
  ]);
  assert.deepEqual(shownPicturesOf(input, { status: "accepted", pictures: [MEMBERS, ACCEPT] }), [
    { picture: MEMBERS, name: "members", caption: "Members page" },
    { picture: ACCEPT, name: "accept", caption: "Accept page" },
  ]);
});

test("an integration's answer names its kept pictures and the ones it left out, by the remote tool, and an image resource's too", () => {
  const answer = [
    { type: "text", text: "2 images extracted from NW-482" },
    { type: "image", mimeType: "image/png", picture: MEMBERS },
    {
      type: "image",
      mimeType: "image/png",
      omitted: PICTURE_OMISSION.TOO_LARGE,
      byteCount: 6_400_000,
    },
    {
      type: "resource",
      resource: { uri: "https://uploads.linear.app/accept.png", picture: ACCEPT },
    },
  ];

  assert.deepEqual(calledPicturesOf("linear_remote", { remoteTool: "extract_images" }, answer), [
    { kept: true, picture: MEMBERS, name: "extract_images-1" },
    {
      kept: false,
      omitted: PICTURE_OMISSION.TOO_LARGE,
      byteCount: 6_400_000,
      name: "extract_images-2",
    },
    { kept: true, picture: ACCEPT, name: "extract_images-3" },
  ]);
  assert.deepEqual(
    calledPicturesOf("connection_execute", {}, answer).map((each) => each.name),
    ["connection_execute-1", "connection_execute-2", "connection_execute-3"],
  );
});

test("a call whose answer is no list of blocks, or whose blocks carry no picture, names none", () => {
  assert.deepEqual(calledPicturesOf("bash", { command: "ls" }, { stdout: "a.png\n" }), []);
  assert.deepEqual(
    calledPicturesOf("linear_remote", {}, [
      { type: "image", mimeType: "image/png", data: "iVBOR" },
    ]),
    [],
    "an image still carried as base64, as a transcript written before pictures were kept holds, is no picture to read",
  );
});

test("a picture is added to a plan's text as its own last paragraph, escaped, and Undo takes exactly that back out", () => {
  const line = taskPictureLine(
    "Members [after]",
    "https://tryluke.dev/acme/plan/5d8e/files/(3c9e)",
  );
  assert.equal(line, "![Members \\[after\\]](https://tryluke.dev/acme/plan/5d8e/files/\\(3c9e\\))");

  for (const plan of [
    "# Teammate invitations\n\nInvite by email.\n",
    "First line  \n",
    "Ends on blank lines\n\n\n",
    "No line break at its end",
    "",
  ]) {
    const addition = withPictureLine(plan, line);
    assert.ok(
      addition.text.startsWith(plan),
      `the text before is kept byte for byte: ${JSON.stringify(plan)}`,
    );
    assert.ok(addition.text.endsWith(`${line}\n`));
    assert.match(addition.text, /(^|\n\n)!\[/u, "the picture stands as a paragraph of its own");
    assert.equal(withoutPictureLine(addition.text, addition.added), plan);
  }
  assert.equal(
    withoutPictureLine("# Moved\n\nThe line was edited away.\n", `\n${line}\n`),
    undefined,
    "an addition no longer standing is left for the developer to take out",
  );
  const afterBlank = withPictureLine("Intro\n\n", line);
  assert.equal(afterBlank.added, `${line}\n`, "no line break is added after a blank line");
  assert.equal(
    withoutPictureLine(`Intro\n\nSee ${line}\nNext`, afterBlank.added),
    undefined,
    "a line moved into the developer's words is no paragraph of its own, and is left alone",
  );
  assert.equal(
    withoutPictureLine(`${afterBlank.text}More words after it.\n`, afterBlank.added),
    undefined,
    "a line the developer wrote straight under is part of their paragraph, and is left alone",
  );
});

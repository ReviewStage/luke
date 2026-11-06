import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  DESCRIPTION_ATTACHMENT_KEEP,
  keepDescriptionAttachment,
  readDescriptionAttachment,
} from "@repo/database/models/description-attachments";
import { createTask, readTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { descriptionAttachmentOf } from "@repo/features/description-attachment-link";
import { DESCRIPTION_ATTACHMENT_BOUNDS } from "@repo/features/description-attachment-wire";
import { descriptionSections } from "@repo/features/description-document";
import {
  PICTURE_BOUNDS,
  PICTURE_MEDIA_TYPE,
  PICTURE_TYPE,
  type Picture,
} from "@repo/features/picture-wire";
import { unparsedWire } from "@repo/wire";
import { paddedTo, webmBytes } from "@repo/wire/testing";
import { Effect, Option } from "effect";
import { Base64 } from "effect/encoding";
import { ACTION_RESULT_STATUS } from "../../core.js";
import { CODER } from "./bounds.js";
import {
  DESCRIPTION_EDIT_REFUSAL,
  descriptionEditRejected,
  recordDescriptionEdit,
  TASK_PICTURE_FILE_REFUSAL,
} from "./description-edit.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

/**
 * A coding agent's `edit_description` adding a screenshot from its sandbox to its
 * plan, through the tool's public function against a real dialect: the
 * picture is kept as one of the plan's pictures, which every member of the
 * plan's workspace reads and nobody else does, and its line lands under its
 * section in a save that is the agent's; a recording is kept as it was
 * recorded, up to a video's bound; a file that is missing, no image,
 * or too large, a plan at its bound of pictures or of videos, and an archived plan are
 * each refused with nothing saved; and the picture's bytes never travel in
 * what the tool answers. The sandbox is the boundary, played by a double
 * holding synthetic files.
 *
 * Synthetic accounts, plans, and pictures throughout.
 */

/** A screenshot's bytes: a PNG's signature and a few more, which is all the store and the sniff read of them. */
const SCREENSHOT = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 9,
]);

/** A sandbox holding the files given by their path from the checkout, each read as one stream. */
function sandboxWith(files: Readonly<Record<string, Uint8Array>>): InboxSandboxDoor {
  const byPath = new Map(
    Object.entries(files).map(([path, bytes]) => [posix.resolve(CODER.CHECKOUT_PATH, path), bytes]),
  );
  return () =>
    Promise.resolve({
      readFile: ({ path }: { path: string }) => {
        const bytes = byPath.get(path);
        if (bytes === undefined) return Promise.resolve(null);
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        );
      },
    });
}

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

/** A plan in a workspace its owner made and a teammate joined, an agent the owner started on it, and an account in neither. */
const openAgentTask = Effect.gen(function* () {
  const owner = yield* openAccount;
  const teammate = yield* openAccount;
  const outsider = yield* openAccount;
  const workspace = yield* openWorkspace(owner);
  yield* joinWorkspace(workspace, teammate);
  const task = yield* createTask(owner, { organizationId: workspace, name: "Invites" });
  const started = yield* createAgent(owner, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    descriptionSnapshot: "# Invites\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  const agentId = Option.getOrThrow(started).agent.id;
  return { owner, teammate, outsider, taskId: task.id, agentId };
});

/** A call adding the one picture at the path given under the plan's approach. */
function pictureCall(path: string) {
  return {
    notes: [],
    pictures: [
      {
        section: "Approach",
        path,
        alt: "Members page with two pending invites",
        caption: "Pending invites sit in the list",
      },
    ],
  };
}

it.layer(getTestDB())("edit_description's pictures", (it) => {
  it.effect(
    "a screenshot lands as its line under its section, kept as a picture every member reads and nobody else does, in a save that is the agent's, and the answer carries none of its bytes",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, taskId, agentId } = yield* openAgentTask;
        const sandbox = sandboxWith({ "shots/members.png": SCREENSHOT });
        const input = {
          pictures: pictureCall("shots/members.png").pictures,
          notes: [{ kind: "add", section: "Approach", text: "- The members page lists invites." }],
        };

        const answer = yield* recordDescriptionEdit(
          { userId: owner, taskId },
          { agentId },
          unparsedWire(input),
          0,
          sandbox,
        );

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 2 });
        assert.equal(JSON.stringify(answer).includes(Base64.encode(SCREENSHOT)), false);
        const stored = Option.getOrThrow(yield* readTask(owner, taskId));
        const approach = descriptionSections(stored.text).find(
          ({ heading }) => heading === "Approach",
        );
        const line = approach?.text.split("\n").at(-1) ?? "";
        const [, address] =
          /^!\[Members page with two pending invites\]\((\S+) "Pending invites sit in the list"\)$/u.exec(
            line,
          ) ?? [];
        assert.ok(address, line);
        assert.ok(approach?.text.includes("- The members page lists invites.\n\n![Members page"));
        const named = descriptionAttachmentOf(address);
        assert.equal(named?.taskId, taskId);
        if (named === undefined) return;
        for (const member of [owner, teammate]) {
          const read: Option.Option<Picture> = yield* readDescriptionAttachment(
            member,
            taskId,
            named.attachmentId,
          );
          assert.deepEqual(
            Option.map(read, ({ contentType }) => contentType),
            Option.some(PICTURE_TYPE.PNG),
          );
          assert.deepEqual(
            Option.map(read, ({ bytes }) => [...bytes]),
            Option.some([...SCREENSHOT]),
          );
        }
        assert.ok(
          Option.isNone(yield* readDescriptionAttachment(outsider, taskId, named.attachmentId)),
        );
        // The save is journaled as the agent's, the picture among the notes it took.
        assert.deepEqual(
          stored.agentEdits.map((edit) => [edit.agentId, edit.notes.length]),
          [[agentId, 2]],
        );
      }),
  );

  it.effect(
    "a missing file, a file that is no image, one past the bound, and pictures past the plan's bound each refuse the call, nothing is saved, and no picture kept before the refusal holds a place in the bound",
    () =>
      Effect.gen(function* () {
        const { owner, taskId, agentId } = yield* openAgentTask;
        const full = yield* openAgentTask;
        const tooLarge = new Uint8Array(1_500_001);
        tooLarge.set(SCREENSHOT);
        const sandbox = sandboxWith({
          "notes.txt": new TextEncoder().encode("Not a picture at all."),
          "huge.png": tooLarge,
          "shots/members.png": SCREENSHOT,
        });
        // One place left, which a call adding two takes with its first before its second is refused.
        for (let kept = 1; kept < DESCRIPTION_ATTACHMENT_BOUNDS.MAX_PER_DESCRIPTION; kept += 1) {
          const picture = { contentType: PICTURE_TYPE.PNG, bytes: SCREENSHOT };
          const answer = yield* keepDescriptionAttachment(full.owner, full.taskId, picture);
          assert.equal(answer.status, DESCRIPTION_ATTACHMENT_KEEP.KEPT);
        }
        const before = Option.getOrThrow(yield* readTask(owner, taskId)).text;
        const edit = (at: { owner: string; taskId: string; agentId: string }, ...paths: string[]) =>
          recordDescriptionEdit(
            { userId: at.owner, taskId: at.taskId },
            { agentId: at.agentId },
            unparsedWire({
              notes: [],
              pictures: paths.flatMap((path) => pictureCall(path).pictures),
            }),
            0,
            sandbox,
          );
        const own = { owner, taskId, agentId };

        const answers = [
          yield* edit(own, "shots/missing.png"),
          yield* edit(own, "notes.txt"),
          yield* edit(own, "huge.png"),
          yield* edit(full, "shots/members.png", "shots/members.png"),
        ];
        const lastPlace = yield* edit(full, "shots/members.png");

        assert.deepEqual(answers, [
          descriptionEditRejected(`${TASK_PICTURE_FILE_REFUSAL.NO_FILE} shots/missing.png`),
          descriptionEditRejected(`${TASK_PICTURE_FILE_REFUSAL.NOT_IMAGE} notes.txt`),
          descriptionEditRejected(`${TASK_PICTURE_FILE_REFUSAL.TOO_LARGE} huge.png`),
          descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.TOO_MANY_PICTURES),
        ]);
        assert.equal(Option.getOrThrow(yield* readTask(owner, taskId)).text, before);
        assert.deepEqual(lastPlace, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          taken: 1,
        });
      }),
  );

  it.effect(
    "a recording lands as its line, kept as it was recorded up to a video's bound, and one past that bound, one that states no size, or one past the plan's videos is refused",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, taskId, agentId } = yield* openAgentTask;
        const full = yield* openAgentTask;
        const recording = paddedTo(webmBytes(1280, 800), PICTURE_BOUNDS.MAX_VIDEO_BYTES);
        const sandbox = sandboxWith({
          "videos/invite.webm": recording,
          "videos/long.webm": paddedTo(recording, PICTURE_BOUNDS.MAX_VIDEO_BYTES + 1),
          "videos/sizeless.webm": paddedTo(webmBytes(1280, 800).subarray(0, 24), 64),
        });
        for (
          let kept = 0;
          kept < DESCRIPTION_ATTACHMENT_BOUNDS.MAX_VIDEOS_PER_DESCRIPTION;
          kept += 1
        ) {
          const video = { contentType: PICTURE_MEDIA_TYPE.WEBM, bytes: webmBytes(640, 400) };
          const answer = yield* keepDescriptionAttachment(full.owner, full.taskId, video);
          assert.equal(answer.status, DESCRIPTION_ATTACHMENT_KEEP.KEPT);
        }
        const edit = (at: { owner: string; taskId: string; agentId: string }, path: string) =>
          recordDescriptionEdit(
            { userId: at.owner, taskId: at.taskId },
            { agentId: at.agentId },
            unparsedWire(pictureCall(path)),
            0,
            sandbox,
          );
        const own = { owner, taskId, agentId };

        const answers = [
          yield* edit(own, "videos/long.webm"),
          yield* edit(own, "videos/sizeless.webm"),
          yield* edit(full, "videos/invite.webm"),
          yield* edit(own, "videos/invite.webm"),
        ];

        assert.deepEqual(answers, [
          descriptionEditRejected(`${TASK_PICTURE_FILE_REFUSAL.TOO_LARGE} videos/long.webm`),
          descriptionEditRejected(`${TASK_PICTURE_FILE_REFUSAL.NOT_IMAGE} videos/sizeless.webm`),
          descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.TOO_MANY_VIDEOS),
          { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 1 },
        ]);
        const stored = Option.getOrThrow(yield* readTask(owner, taskId));
        const [, address] = /\]\((\S+) "/u.exec(stored.text) ?? [];
        const named = address === undefined ? undefined : descriptionAttachmentOf(address);
        assert.ok(named, stored.text);
        const read = yield* readDescriptionAttachment(teammate, taskId, named.attachmentId);
        assert.deepEqual(
          Option.map(read, ({ contentType }) => contentType),
          Option.some(PICTURE_MEDIA_TYPE.WEBM),
        );
        assert.deepEqual(
          Option.map(read, ({ bytes }) => bytes.length),
          Option.some(recording.length),
        );
      }),
  );
});

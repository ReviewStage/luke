import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import {
  keepPlanAttachment,
  PLAN_ATTACHMENT_KEEP,
  readPlanAttachment,
} from "@luke/database/models/plan-attachments";
import { createTask, readTask, updateTask } from "@luke/database/models/task-store";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { PICTURE_TYPE, type Picture } from "@luke/features/picture-wire";
import { planAttachmentOf } from "@luke/features/plan-attachment-link";
import { PLAN_ATTACHMENT_BOUNDS } from "@luke/features/plan-attachment-wire";
import { planSections } from "@luke/features/plan-document";
import { unparsedWire, type WireRecord } from "@luke/wire";
import { Effect, Option } from "effect";
import { Base64 } from "effect/encoding";
import { ACTION_RESULT_STATUS } from "../../core.js";
import { stampedEveEvent } from "../../testing/eve-events.js";
import { CODER } from "./bounds.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import {
  PLAN_EDIT_REFUSAL,
  planEditRejected,
  recordPlanEdit,
  TASK_PICTURE_FILE_REFUSAL,
} from "./plan-edit.js";
import { CODER_TOOL, opensSandbox } from "./tool-set.js";

/**
 * A coding agent's `edit_plan` adding a screenshot from its sandbox to its
 * plan, through the tool's public function against a real dialect: the
 * picture is kept as one of the plan's pictures, which every member of the
 * plan's workspace reads and nobody else does, and its line lands under its
 * section in a save that is the agent's; a file that is missing, no image,
 * or too large, a plan at its bound of pictures, and an archived plan are
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
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
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
  const started = yield* createCodingAgent(owner, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Invites\n",
    prompt: null,
  });
  const agentId = Option.getOrThrow(started).agent.id;
  return { owner, teammate, outsider, planId: task.id, agentId };
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

it.layer(getTestDB())("edit_plan's pictures", (it) => {
  it.effect(
    "a screenshot lands as its line under its section, kept as a picture every member reads and nobody else does, in a save that is the agent's, and the answer carries none of its bytes",
    () =>
      Effect.gen(function* () {
        const { owner, teammate, outsider, planId: taskId, agentId } = yield* openAgentTask;
        const sandbox = sandboxWith({ "shots/members.png": SCREENSHOT });
        const input = {
          pictures: pictureCall("shots/members.png").pictures,
          notes: [{ kind: "add", section: "Approach", text: "- The members page lists invites." }],
        };

        const answer = yield* recordPlanEdit(
          { userId: owner, taskId: taskId },
          { agentId },
          unparsedWire(input),
          0,
          sandbox,
        );

        assert.deepEqual(answer, { status: ACTION_RESULT_STATUS.ACCEPTED, taken: 2 });
        assert.equal(JSON.stringify(answer).includes(Base64.encode(SCREENSHOT)), false);
        const stored = Option.getOrThrow(yield* readTask(owner, taskId));
        const approach = planSections(stored.text).find(({ heading }) => heading === "Approach");
        const line = approach?.text.split("\n").at(-1) ?? "";
        const [, address] =
          /^!\[Members page with two pending invites\]\((\S+) "Pending invites sit in the list"\)$/u.exec(
            line,
          ) ?? [];
        assert.ok(address, line);
        assert.ok(approach?.text.includes("- The members page lists invites.\n\n![Members page"));
        const named = planAttachmentOf(address);
        assert.equal(named?.taskId, taskId);
        if (named === undefined) return;
        for (const member of [owner, teammate]) {
          const read: Option.Option<Picture> = yield* readPlanAttachment(
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
        assert.ok(Option.isNone(yield* readPlanAttachment(outsider, taskId, named.attachmentId)));
        // The save is journaled as the agent's, the picture among the notes it took.
        assert.deepEqual(
          stored.agentEdits.map((edit) => [edit.agentId, edit.notes.length]),
          [[agentId, 2]],
        );
      }),
  );

  it.effect(
    "a missing file, a file that is no image, one past the bound, pictures past the plan's bound, and an archived plan each refuse the call, nothing is saved, and no picture kept before the refusal holds a place in the bound",
    () =>
      Effect.gen(function* () {
        const { owner, planId: taskId, agentId } = yield* openAgentTask;
        const full = yield* openAgentTask;
        const archived = yield* openAgentTask;
        const tooLarge = new Uint8Array(1_500_001);
        tooLarge.set(SCREENSHOT);
        const sandbox = sandboxWith({
          "notes.txt": new TextEncoder().encode("Not a picture at all."),
          "huge.png": tooLarge,
          "shots/members.png": SCREENSHOT,
        });
        // One place left, which a call adding two takes with its first before its second is refused.
        for (let kept = 1; kept < PLAN_ATTACHMENT_BOUNDS.MAX_PER_PLAN; kept += 1) {
          const picture = { contentType: PICTURE_TYPE.PNG, bytes: SCREENSHOT };
          const answer = yield* keepPlanAttachment(full.owner, full.planId, picture);
          assert.equal(answer.status, PLAN_ATTACHMENT_KEEP.KEPT);
        }
        yield* updateTask(archived.owner, archived.planId, { archived: true });
        const before = Option.getOrThrow(yield* readTask(owner, taskId)).text;
        const edit = (at: { owner: string; planId: string; agentId: string }, ...paths: string[]) =>
          recordPlanEdit(
            { userId: at.owner, taskId: at.planId },
            { agentId: at.agentId },
            unparsedWire({
              notes: [],
              pictures: paths.flatMap((path) => pictureCall(path).pictures),
            }),
            0,
            sandbox,
          );
        const own = { owner, planId: taskId, agentId };

        const answers = [
          yield* edit(own, "shots/missing.png"),
          yield* edit(own, "notes.txt"),
          yield* edit(own, "huge.png"),
          yield* edit(full, "shots/members.png", "shots/members.png"),
          yield* edit(archived, "shots/members.png"),
        ];
        const lastPlace = yield* edit(full, "shots/members.png");

        assert.deepEqual(answers, [
          planEditRejected(`${TASK_PICTURE_FILE_REFUSAL.NO_FILE} shots/missing.png`),
          planEditRejected(`${TASK_PICTURE_FILE_REFUSAL.NOT_IMAGE} notes.txt`),
          planEditRejected(`${TASK_PICTURE_FILE_REFUSAL.TOO_LARGE} huge.png`),
          planEditRejected(PLAN_EDIT_REFUSAL.TOO_MANY_PICTURES),
          planEditRejected(PLAN_EDIT_REFUSAL.ARCHIVED),
        ]);
        assert.equal(Option.getOrThrow(yield* readTask(owner, taskId)).text, before);
        assert.deepEqual(lastPlace, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          taken: 1,
        });
      }),
  );

  it.effect(
    "an edit adding a picture opens the agent's sandbox, and one of notes alone does not",
    () =>
      Effect.sync(() => {
        const requested = (input: WireRecord) =>
          stampedEveEvent(
            {
              type: "actions.requested",
              data: {
                turnId: "turn_0",
                sequence: 0,
                stepIndex: 0,
                actions: [
                  { kind: "tool-call", callId: "call-1", toolName: CODER_TOOL.EDIT_PLAN, input },
                ],
              },
            },
            1_800_000_000_000,
          );

        assert.equal(opensSandbox(requested(pictureCall("shots/members.png"))), true);
        assert.equal(opensSandbox(requested({ notes: [] })), false);
        assert.equal(opensSandbox(requested({ notes: [], pictures: [] })), false);
      }),
  );
});

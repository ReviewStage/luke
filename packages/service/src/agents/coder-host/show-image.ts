import type { DatabaseServices } from "@luke/database/core/query";
import { keepConversationPicture } from "@luke/database/models/conversation-pictures";
import type { PlanStoreFailure } from "@luke/database/models/plan-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import {
  CONVERSATION_PICTURE_BOUNDS,
  type KeptPicture,
} from "@luke/features/conversation-picture-wire";
import { imageDimensions } from "@luke/features/image-signature";
import { INBOX_BOUNDS } from "@luke/features/inbox-wire";
import { describeWire, readEither } from "@luke/wire/effect";
import { Data, Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";
import { type InboxSandboxDoor, readSandboxImage } from "./inbox-image.js";

/**
 * show-image.ts -- a coding agent or its worker shows the developer pictures from its sandbox, kept beside its transcript as one set.
 *
 * The agent names each file by its path and says in a line what it shows;
 * the service reads each through the same door the agent's file tools reach
 * the sandbox by (`inbox-image.ts`), held to a picture's bound and the three
 * types, measures it, and keeps it beside the transcript the call is written
 * to (`conversation-pictures.ts`), the agent's own or its worker's. The
 * answer names each kept picture by id, never by its bytes, so the record
 * carries an id, and the developer's window draws the set from it. The
 * model is answered in words and ids alone: it made the files, and reads
 * one back with `read_file` when it wants to look. A call is shown whole or
 * not at all: the first file refused refuses the call in one sentence the
 * model can act on, naming the path, before anything is kept, and a set
 * the transcript has room for only part of keeps none of it.
 */

/** Why a call showed nothing, in the words the model reads; a sentence ending in a colon is followed by the path. */
export const SHOW_IMAGE_REFUSAL = {
  UNREADABLE: `Not shown: give images as a list of 1 to ${CONVERSATION_PICTURE_BOUNDS.MAX_PER_CALL} items, each a path in your sandbox and a caption of one line of at most ${INBOX_BOUNDS.MAX_ALT_CHARS} characters.`,
  NO_FILE: "Not shown: no such file in your sandbox:",
  NOT_IMAGE: "Not shown: that file is not a PNG, JPEG, or WebP image whose header states its size:",
  TOO_LARGE: `Not shown: a picture is kept up to ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB. Save it smaller, as a JPEG or a WebP, or as the part of the page that matters, and show it again:`,
  UNREADABLE_FILE: "Not shown: that file could not be read from your sandbox:",
  FULL: `Not shown: this transcript already keeps ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION / 1_000_000} MB of pictures, as many as it may.`,
  UNAVAILABLE: "Not shown: the pictures could not be kept just now. The call may be made again.",
} as const;

const SHOW_IMAGE_INPUT = Schema.Struct({
  images: describeWire(
    Schema.Array(
      Schema.Struct({
        path: describeWire(
          Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(INBOX_BOUNDS.MAX_PATH_CHARS)),
          "The picture's file in your sandbox, relative to the checkout or absolute: a PNG, JPEG, or WebP.",
        ),
        caption: describeWire(
          Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(INBOX_BOUNDS.MAX_ALT_CHARS)),
          "What the picture shows, in one line: its caption under it and its words for a reader who cannot see it.",
        ),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(CONVERSATION_PICTURE_BOUNDS.MAX_PER_CALL)),
    "The pictures to show, in the order they are read; several shown in one call stand together as one set.",
  ),
});

export const SHOW_IMAGE_TOOL = {
  name: AGENT_TOOL.SHOW_IMAGE,
  description:
    "Show the developer pictures from your sandbox in your transcript, such as screenshots of a UI " +
    "you changed, after a change to anything they can see. Take the screenshot first, for instance " +
    "with Playwright (`npx playwright screenshot <url> <file>`, installing it where it is missing), " +
    "then name each file by its path with a one-line caption saying what it shows. Show the pictures " +
    "that belong together in one call, as one set: before and after, or each screen a change touches. " +
    `Each is a PNG, JPEG, or WebP of at most ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB. ` +
    "Never show a picture of a secret. A Markdown image in your reply shows nothing; this is the one " +
    "way to show a picture. Answers `accepted` with each picture's id, or `rejected` and why nothing " +
    "was shown.",
  inputSchema: SHOW_IMAGE_INPUT,
} as const;

/** A call that showed nothing, and why. */
export function showImageRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** Where one call's pictures are read from and kept: the transcript it is written to, and the sandbox it names files in. */
export interface ShowImageBinding {
  readonly target: ConversationTarget;
  readonly sandbox: InboxSandboxDoor;
  readonly checkout: string;
}

/** One picture read and measured, ready to keep. */
interface ReadPicture {
  readonly bytes: Uint8Array;
  readonly contentType: KeptPicture["mediaType"];
  readonly width: number;
  readonly height: number;
}

/** The picture at the path, read, held to the bound, and measured; or the sentence refusing it. */
function readPicture(
  binding: ShowImageBinding,
  path: string,
): Effect.Effect<Result.Result<ReadPicture, string>> {
  return Effect.map(
    readSandboxImage(binding.sandbox, binding.checkout, path, {
      maxBytes: CONVERSATION_PICTURE_BOUNDS.MAX_BYTES,
      refusals: {
        NO_FILE: SHOW_IMAGE_REFUSAL.NO_FILE,
        NOT_IMAGE: SHOW_IMAGE_REFUSAL.NOT_IMAGE,
        TOO_LARGE: SHOW_IMAGE_REFUSAL.TOO_LARGE,
        UNREADABLE: SHOW_IMAGE_REFUSAL.UNREADABLE_FILE,
      },
    }),
    Result.flatMap((image) => {
      const dimensions = imageDimensions(image.bytes, image.contentType);
      if (dimensions === undefined) return Result.fail(`${SHOW_IMAGE_REFUSAL.NOT_IMAGE} ${path}`);
      return Result.succeed({ ...image, ...dimensions });
    }),
  );
}

/** A set the transcript has no room for whole, which rolls back what of it was kept. */
class SetPastBudget extends Data.TaggedError("SetPastBudget") {}

/**
 * Every picture kept, in order, in one transaction; nothing where the
 * transcript has room for only part of the set. Note that a refusal fails
 * the transaction rather than returning from it, because the pictures kept
 * before it would otherwise stand, counted against the budget, named by no
 * answer.
 */
function keepAll(
  target: ConversationTarget,
  pictures: readonly ReadPicture[],
): Effect.Effect<Option.Option<readonly KeptPicture[]>, PlanStoreFailure, DatabaseServices> {
  const all = Effect.gen(function* () {
    const kept: KeptPicture[] = [];
    for (const picture of pictures) {
      const one = yield* keepConversationPicture(target, picture);
      if (Option.isNone(one)) return yield* Effect.fail(new SetPastBudget());
      kept.push(one.value);
    }
    return kept;
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(all)).pipe(
    Effect.map(Option.some),
    Effect.catchTag("SetPastBudget", () => Effect.succeed(Option.none())),
  );
}

/**
 * One `show_image` call: every file read before any is kept, so a refused
 * file shows nothing; then each kept beside the transcript in the order
 * given, the same bytes answered as the row already kept. A store that
 * fails answers that the call may be made again, as a page's does.
 */
export function runShowImage(
  binding: ShowImageBinding,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const read = readEither(SHOW_IMAGE_INPUT)(input);
    if (Result.isFailure(read)) return showImageRejected(SHOW_IMAGE_REFUSAL.UNREADABLE);
    const pictures: ReadPicture[] = [];
    for (const image of read.success.images) {
      const picture = yield* readPicture(binding, image.path);
      if (Result.isFailure(picture)) return showImageRejected(picture.failure);
      pictures.push(picture.success);
    }
    const kept = yield* keepAll(binding.target, pictures);
    if (Option.isNone(kept)) return showImageRejected(SHOW_IMAGE_REFUSAL.FULL);
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      pictures: kept.value.map((each) => ({ ...each })),
    };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(showImageRejected(SHOW_IMAGE_REFUSAL.UNAVAILABLE))),
  );
}

import type { DatabaseServices } from "@repo/database/core/query";
import { keepConversationPicture } from "@repo/database/models/conversation-pictures";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { asPictureList } from "@repo/features/agent-pictures-model";
import {
  CONVERSATION_PICTURE_BOUNDS,
  type KeptPicture,
} from "@repo/features/conversation-picture-wire";
import { INBOX_BOUNDS } from "@repo/features/inbox-wire";
import { mediaDimensions, sniffMediaType } from "@repo/features/media-signature";
import { describeWire, readEither } from "@repo/wire/effect";
import { Data, Effect, Option, Result, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, type WireRecord } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { AGENT_TOOL } from "../agent-runtime/tools.js";
import { type InboxSandboxDoor, readSandboxImage } from "./inbox-image.js";

export const SHOW_IMAGE_REFUSAL = {
  UNREADABLE: `Not shown: give images as a list of 1 to ${CONVERSATION_PICTURE_BOUNDS.MAX_PER_CALL} items, each a path in your sandbox and a caption of one line of at most ${INBOX_BOUNDS.MAX_ALT_CHARS} characters.`,
  NO_FILE: "Not shown: no such file in your sandbox:",
  NOT_IMAGE:
    "Not shown: that file is not a PNG, JPEG, or WebP image whose header states its size, or a WebM video whose video track states its size:",
  TOO_LARGE: `Not shown: a picture or a video is kept up to ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB. Save a picture smaller, as a JPEG or a WebP, or as the part of the page that matters; record a video shorter or smaller; and show it again:`,
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
          "The picture's file in your sandbox, relative to the checkout or absolute: a PNG, JPEG, or WebP, or a WebM video.",
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
    "with Playwright's `playwright screenshot <url> <file>`, installed in a cloud sandbox, or on the " +
    "developer's Mac whatever the repository or the Mac has, " +
    "then name each file by its path with a one-line caption saying what it shows. Show the pictures " +
    "that belong together in one call, as one set: before and after, or each screen a change touches. " +
    "To show a flow rather than a screen, such as clicking through a form you built, record it as a " +
    "WebM video, for instance with Playwright's `page.screencast.start({ path })` once the page has " +
    "drawn, so the video opens on it rather than on its loading, and show that file the same way; the " +
    "transcript plays it. " +
    `Each is a PNG, JPEG, or WebP, or a WebM video, of at most ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB. ` +
    `Never show a picture of a secret. Never show pictures of a page you showed with \`${AGENT_TOOL.SHOW_PAGE}\`, ` +
    "or the page beside pictures of it: choose one, the page where it says what you mean, or " +
    "pictures where they say it better, such as parts of a page set side by side. " +
    "A Markdown image in your reply shows nothing; this is the one " +
    "way to show a picture in your transcript. Answers `accepted` with each picture's id, or `rejected` and why nothing " +
    "was shown.",
  inputSchema: SHOW_IMAGE_INPUT,
} as const;

export function showImageRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

export interface ShowImageBinding {
  readonly target: ConversationTarget;
  readonly sandbox: InboxSandboxDoor;
  readonly checkout: string;
}

interface ReadPicture {
  readonly bytes: Uint8Array;
  readonly contentType: KeptPicture["mediaType"];
  readonly width: number;
  readonly height: number;
}

function readPicture(
  binding: ShowImageBinding,
  path: string,
): Effect.Effect<Result.Result<ReadPicture, string>> {
  return Effect.map(
    readSandboxImage(binding.sandbox, binding.checkout, path, {
      maxBytes: CONVERSATION_PICTURE_BOUNDS.MAX_BYTES,
      sniff: sniffMediaType,
      refusals: {
        NO_FILE: SHOW_IMAGE_REFUSAL.NO_FILE,
        NOT_IMAGE: SHOW_IMAGE_REFUSAL.NOT_IMAGE,
        TOO_LARGE: SHOW_IMAGE_REFUSAL.TOO_LARGE,
        UNREADABLE: SHOW_IMAGE_REFUSAL.UNREADABLE_FILE,
      },
    }),
    Result.flatMap((image) => {
      const dimensions = mediaDimensions(image.bytes, image.contentType);
      if (dimensions === undefined) return Result.fail(`${SHOW_IMAGE_REFUSAL.NOT_IMAGE} ${path}`);
      return Result.succeed({ ...image, ...dimensions });
    }),
  );
}

class SetPastBudget extends Data.TaggedError("SetPastBudget") {}

function keepAll(
  target: ConversationTarget,
  pictures: readonly ReadPicture[],
): Effect.Effect<Option.Option<readonly KeptPicture[]>, TaskStoreFailure, DatabaseServices> {
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

export function runShowImage(
  binding: ShowImageBinding,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const read = readEither(SHOW_IMAGE_INPUT)(asPictureList(input));
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

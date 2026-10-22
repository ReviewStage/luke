import type { DatabaseServices } from "@luke/database/core/query";
import {
  dataUrl,
  fileMark,
  type HandedFile,
  inlinedFile,
  isMentionedText,
  type KeptImage,
  keptImageLine,
  keptImageMetadata,
  keptImageOfLine,
  textOf,
} from "@luke/database/models/attached-file-parts";
import { keepConversationPicture } from "@luke/database/models/conversation-pictures";
import { COALESCED_LINE_SEPARATOR } from "@luke/database/models/message-reads";
import type { TaskStoreFailure } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import {
  CONVERSATION_PICTURE_BOUNDS,
  PICTURE_OMISSION,
} from "@luke/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@luke/features/image-signature";
import type { FileUIPart, UserContent } from "ai";
import { Effect, Option } from "effect";
import type { MessageReceivedPart } from "eve/client";

/**
 * attached-files.ts -- the files a developer attached to a coding agent's message: as eve is handed them, and as eve's receipt of them reads back. How the journal keeps them is `@luke/database/models/attached-file-parts`.
 *
 * A message is words, files, or both. eve is handed the words first where
 * there are any, then each text file inlined as its own text part, headed
 * by its name and fenced, since no provider path takes a text file as a
 * file, then each image and PDF as a file part over a `data:` URL, which
 * eve stages in the sandbox, opening it to do so. The journal keeps the words
 * as the row's first part, empty where there are none, and every file
 * after it as the SDK's file part over the same `data:` URL, a text file
 * under `text/plain`, so the transcript draws a thumbnail or a name for
 * each from the row alone. eve's receipt of a message flattens its files
 * into placeholders, so a line is matched by its parts instead: the words
 * and each text file as eve was handed them, and each image and PDF by its
 * name and type, joined by the separator eve joins coalesced steers with,
 * which is what eve's received parts join to whether the steers it
 * coalesced carried words, files, or both. A receipt the relay writes as a
 * row of its own, such as a task's, reads its text files back to file
 * parts by their heading, so the developer's bubble shows a name rather
 * than the file.
 *
 * Every image a coding agent is handed, whoever sent it, is first kept
 * beside the agent's conversation as a tool's pictures are
 * (`keptHandedImages`, `conversation-pictures.ts`), and eve is handed one
 * more text part right after the image: the line naming the attachment it
 * was kept as, or why it was not kept, which a native harness reads as
 * text alike. The journal keeps that on the image's file part, a line is
 * matched by the line in the place eve was handed it, and a receipt's own
 * row reads the id back from it onto its file part, so a Start's first
 * message, whose row eve's receipt writes with no bytes, still names the
 * picture its Continue attaches again (`replay.ts`).
 */

/** A text file as eve's receipt carries it: the heading's name, a fence, the file, and the same fence. */
const INLINED_FILE = /^Attached file: ([^\n]+)\n(`{3,})\n([\s\S]*)\n\2$/u;

/** The types an attached file is a picture under, which a conversation keeps. */
const IMAGE_TYPES: ReadonlySet<string> = new Set([
  CODING_AGENT_ATTACHMENT_TYPE.PNG,
  CODING_AGENT_ATTACHMENT_TYPE.JPEG,
  CODING_AGENT_ATTACHMENT_TYPE.WEBP,
]);

/** One image kept beside the conversation, as its bytes are sniffed and measured, or why it was not kept. */
function keptImage(
  target: ConversationTarget,
  file: CodingAgentAttachment,
): Effect.Effect<KeptImage, TaskStoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const bytes = new Uint8Array(Buffer.from(file.data, "base64"));
    if (bytes.byteLength > CONVERSATION_PICTURE_BOUNDS.MAX_BYTES) {
      return { omitted: PICTURE_OMISSION.TOO_LARGE };
    }
    const contentType = sniffImageType(bytes);
    const dimensions = contentType === undefined ? undefined : imageDimensions(bytes, contentType);
    if (contentType === undefined || dimensions === undefined) {
      return { omitted: PICTURE_OMISSION.UNSUPPORTED };
    }
    const kept = yield* keepConversationPicture(target, { bytes, contentType, ...dimensions });
    return Option.isSome(kept) ? { id: kept.value.id } : { omitted: PICTURE_OMISSION.LIMIT };
  });
}

/**
 * The files a coding agent is handed, each image kept beside the
 * conversation the agent runs in and named by what was kept of it, in the
 * order given; a PDF or a text file is handed as it came, since a
 * conversation keeps pictures alone. Note that the same bytes handed again,
 * as a send repeated under its key, answer the row already kept, because a
 * conversation's picture is keyed by its hash.
 */
export function keptHandedImages(
  target: ConversationTarget,
  files: readonly CodingAgentAttachment[],
): Effect.Effect<readonly HandedFile[], TaskStoreFailure, DatabaseServices> {
  return Effect.forEach(files, (file) =>
    IMAGE_TYPES.has(file.mediaType)
      ? Effect.map(keptImage(target, file), (kept): HandedFile => ({ ...file, kept }))
      : Effect.succeed<HandedFile>(file),
  );
}

/**
 * What eve is handed for a message: the words alone where nothing is
 * attached and nothing mentioned, as every message went before files, and
 * otherwise the words where there are any, what they mention that the agent
 * cannot read for itself (`mentioned-context.ts`), the text files inlined,
 * and the images and PDFs as file parts, each image followed by the line
 * naming what was kept of it where it was kept or refused, so a model is
 * never handed an empty text part.
 */
export function eveContent(
  text: string,
  attachments: readonly HandedFile[],
  mentioned?: string,
): string | UserContent {
  if (attachments.length === 0 && mentioned === undefined) return text;
  const texts = attachments.flatMap((file) =>
    file.mediaType === CODING_AGENT_ATTACHMENT_TYPE.TEXT
      ? [{ type: "text" as const, text: inlinedFile(file.name, textOf(file.data)) }]
      : [],
  );
  const files = attachments.flatMap((file) =>
    file.mediaType === CODING_AGENT_ATTACHMENT_TYPE.TEXT
      ? []
      : [
          {
            type: "file" as const,
            data: dataUrl(file.mediaType, file.data),
            mediaType: file.mediaType,
            filename: file.name,
          },
          ...(file.kept === undefined
            ? []
            : [{ type: "text" as const, text: keptImageLine(file.name, file.kept) }]),
        ],
  );
  return [
    ...(text === "" ? [] : [{ type: "text" as const, text }]),
    ...(mentioned === undefined ? [] : [{ type: "text" as const, text: mentioned }]),
    ...texts,
    ...files,
  ];
}

/** A message eve received, read back: the parts a line is matched by, joined, and the words and files a receipt's own row keeps. */
export interface ReceivedMessage {
  readonly text: string;
  readonly words: string;
  readonly files: readonly FileUIPart[];
}

/** One text part of a receipt, read back as the text file it inlines, or nothing where it inlines none. */
function inlinedFileOf(text: string): FileUIPart | undefined {
  const inlined = INLINED_FILE.exec(text);
  if (inlined === null) return undefined;
  const [, name = "", , file = ""] = inlined;
  return {
    type: "file",
    mediaType: CODING_AGENT_ATTACHMENT_TYPE.TEXT,
    filename: name,
    url: dataUrl(CODING_AGENT_ATTACHMENT_TYPE.TEXT, Buffer.from(file, "utf8").toString("base64")),
  };
}

/**
 * A receipt's image with what the text part right after it says was kept of
 * it, and no bytes where it was kept, as a line's row names one
 * (`lineParts`); nothing where that text says nothing of it.
 */
function keptOnto(image: FileUIPart, text: string): FileUIPart | undefined {
  const kept = keptImageOfLine(image.filename ?? "", text);
  if (kept === undefined) return undefined;
  const url = "id" in kept ? "" : image.url;
  return { ...image, url, providerMetadata: keptImageMetadata(kept) };
}

/**
 * eve's receipt of a message read back. Its parts joined, each image and
 * PDF by its mark, are what a line is matched by; an eve that projects no
 * parts is read by its summary, which for words alone is the words. A text
 * part right after an image that names what was kept of it is that, and
 * goes onto the image's part; a text part spelled as a text file's heading
 * and fence is that file, and every other is words, since a message may
 * carry files with no words. A file staged in the sandbox carries no URL,
 * so its part keeps its name and no bytes; eve stages every file a message
 * carries, a task's included, so a receipt's own row names each file and
 * draws none.
 */
export function receivedMessage(received: {
  readonly message: string;
  readonly parts?: readonly MessageReceivedPart[] | undefined;
}): ReceivedMessage {
  if (received.parts === undefined) {
    return { text: received.message, words: received.message, files: [] };
  }
  const texts: string[] = [];
  const words: string[] = [];
  const files: FileUIPart[] = [];
  for (const [index, part] of received.parts.entries()) {
    if (part.type === "text") {
      texts.push(part.text);
      // The line naming what was kept of the image just before it is that image's, and no words.
      const image = received.parts[index - 1]?.type === "file" ? files.at(-1) : undefined;
      const kept = image === undefined ? undefined : keptOnto(image, part.text);
      if (kept !== undefined) {
        files[files.length - 1] = kept;
        continue;
      }
      // The part a line's mentions were handed in matches the line, and is no
      // words of its own. Note that it always follows the words that named
      // them, so a first part spelled like it is the developer's words still.
      if (index > 0 && isMentionedText(part.text)) continue;
      const inlined = inlinedFileOf(part.text);
      if (inlined === undefined) words.push(part.text);
      else files.push(inlined);
      continue;
    }
    texts.push(fileMark(part.filename, part.mediaType));
    files.push({
      type: "file",
      mediaType: part.mediaType,
      ...(part.filename === undefined ? undefined : { filename: part.filename }),
      url: part.url ?? "",
    });
  }
  return {
    text: texts.join(COALESCED_LINE_SEPARATOR),
    words: words.join(COALESCED_LINE_SEPARATOR),
    files,
  };
}

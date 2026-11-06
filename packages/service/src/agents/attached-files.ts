import type { DatabaseServices } from "@repo/database/core/query";
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
} from "@repo/database/models/attached-file-parts";
import { keepConversationPicture } from "@repo/database/models/conversation-pictures";
import { COALESCED_LINE_SEPARATOR } from "@repo/database/models/message-reads";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_ATTACHMENT_TYPE, type AgentAttachment } from "@repo/features/agent-wire";
import {
  CONVERSATION_PICTURE_BOUNDS,
  PICTURE_OMISSION,
} from "@repo/features/conversation-picture-wire";
import { imageDimensions, sniffImageType } from "@repo/features/image-signature";
import { MENTION_KIND, memberMentionOf } from "@repo/features/mention-link";
import type { FileUIPart, UserContent } from "ai";
import { Effect, Option } from "effect";

const INLINED_FILE = /^Attached file: ([^\n]+)\n(`{3,})\n([\s\S]*)\n\2$/u;

const IMAGE_TYPES: ReadonlySet<string> = new Set([
  AGENT_ATTACHMENT_TYPE.PNG,
  AGENT_ATTACHMENT_TYPE.JPEG,
  AGENT_ATTACHMENT_TYPE.WEBP,
]);

function keptImage(
  target: ConversationTarget,
  file: AgentAttachment,
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

export function keptHandedImages(
  target: ConversationTarget,
  files: readonly AgentAttachment[],
): Effect.Effect<readonly HandedFile[], TaskStoreFailure, DatabaseServices> {
  return Effect.forEach(files, (file) =>
    IMAGE_TYPES.has(file.mediaType)
      ? Effect.map(keptImage(target, file), (kept): HandedFile => ({ ...file, kept }))
      : Effect.succeed<HandedFile>(file),
  );
}

export const SENDER_LABEL_LEAD = "[sender: ";

const SENDER_LABEL_TAIL = ", a teammate]";

export function senderLabel(teammate: string): string {
  return `${SENDER_LABEL_LEAD}${teammate}${SENDER_LABEL_TAIL}`;
}

function isSenderLabel(text: string): boolean {
  if (!text.startsWith(SENDER_LABEL_LEAD) || !text.endsWith(SENDER_LABEL_TAIL)) return false;
  const link = text.slice(SENDER_LABEL_LEAD.length, -SENDER_LABEL_TAIL.length);
  return link.startsWith("[@") && memberMentionOf(link)?.kind === MENTION_KIND.PERSON;
}

export function eveContent(
  text: string,
  attachments: readonly HandedFile[],
  mentioned?: string,
  sender?: string,
): string | UserContent {
  if (attachments.length === 0 && mentioned === undefined && sender === undefined) return text;
  const texts = attachments.flatMap((file) =>
    file.mediaType === AGENT_ATTACHMENT_TYPE.TEXT
      ? [{ type: "text" as const, text: inlinedFile(file.name, textOf(file.data)) }]
      : [],
  );
  const files = attachments.flatMap((file) =>
    file.mediaType === AGENT_ATTACHMENT_TYPE.TEXT
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
    ...(sender === undefined ? [] : [{ type: "text" as const, text: sender }]),
    ...(text === "" ? [] : [{ type: "text" as const, text }]),
    ...(mentioned === undefined ? [] : [{ type: "text" as const, text: mentioned }]),
    ...texts,
    ...files,
  ];
}

export interface ReceivedMessage {
  readonly text: string;
  readonly words: string;
  readonly files: readonly FileUIPart[];
}

function inlinedFileOf(text: string): FileUIPart | undefined {
  const inlined = INLINED_FILE.exec(text);
  if (inlined === null) return undefined;
  const [, name = "", , file = ""] = inlined;
  return {
    type: "file",
    mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
    filename: name,
    url: dataUrl(AGENT_ATTACHMENT_TYPE.TEXT, Buffer.from(file, "utf8").toString("base64")),
  };
}

function keptOnto(image: FileUIPart, text: string): FileUIPart | undefined {
  const kept = keptImageOfLine(image.filename ?? "", text);
  if (kept === undefined) return undefined;
  const url = "id" in kept ? "" : image.url;
  return { ...image, url, providerMetadata: keptImageMetadata(kept) };
}

export type MessageReceivedPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "file";
      readonly mediaType: string;
      readonly filename?: string;
      readonly url?: string;
    };

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
      if (index === 0 && received.parts.length > 1 && isSenderLabel(part.text)) continue;
      texts.push(part.text);
      const image = received.parts[index - 1]?.type === "file" ? files.at(-1) : undefined;
      const kept = image === undefined ? undefined : keptOnto(image, part.text);
      if (kept !== undefined) {
        files[files.length - 1] = kept;
        continue;
      }
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

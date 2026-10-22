import { UI_PART_STATE, UI_PART_TYPE } from "@luke/features/brain";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  type CodingAgentAttachment,
} from "@luke/features/coding-agent-wire";
import {
  CONVERSATION_PICTURE_BOUNDS,
  PICTURE_OMISSION,
  type PictureOmission,
} from "@luke/features/conversation-picture-wire";
import {
  type DataUIPart,
  type FileUIPart,
  isFileUIPart,
  isTextUIPart,
  type ProviderMetadata,
  type TextUIPart,
  type UIDataTypes,
  type UIMessage,
} from "ai";
import { Schema as EffectSchema, Option } from "effect";

/**
 * attached-file-parts.ts -- the files a developer attached to a coding agent's message as the journal keeps them, and as eve's receipt of them reads back for matching.
 *
 * The journal keeps the words as the row's first part, empty where there
 * are none, and every file after it as the SDK's file part over a `data:`
 * URL, a text file under `text/plain`, so the transcript draws a thumbnail
 * or a name for each from the row alone. eve is handed each text file
 * inlined under a heading and a fence (`packages/service/src/agents/attached-files.ts`),
 * and its receipt lists a line's parts the way it was handed them, so a
 * line is matched by its words, each text file inlined, and each image and
 * PDF by its mark.
 *
 * A line that mentions what eve cannot read for itself, a section of the
 * plan, carries one more text part after its words: what it named, as it
 * stood when the line was sent, under a heading of its own
 * (`packages/service/src/agents/mentioned-context.ts`). The journal keeps it as
 * a data part after the words, so the transcript draws only the words, and
 * a receipt is matched by it in the place eve was handed it.
 *
 * An image the agent was handed is also kept beside its conversation, as a
 * tool's pictures are (`conversation-pictures.ts`), and eve is handed one
 * more text part right after the image's file part: the line naming the
 * kept picture's id, or why it was not kept (`keptImageLine`). The journal
 * keeps what was kept on the image's own file part, under the provider key
 * no provider reads (`keptImageMetadata`), rather than as a part of its
 * own, so the transcript draws and counts the same files it always did; a
 * receipt is matched by the line in the place eve was handed it, and a
 * receipt's own row reads the id back from it.
 */

/** What heads the part a line's mentions are handed to eve in, which the receipt is read back by. */
export const MENTIONED_HEADING =
  "Mentioned in this message, as it stood when the message was sent:";

/** The data part the journal keeps a line's mentioned part as. */
const MENTIONED_PART_TYPE = "data-luke-mentioned";

/** Whether a text part eve was handed is a line's mentioned part rather than its words. */
export function isMentionedText(text: string): boolean {
  return text.startsWith(MENTIONED_HEADING);
}

/** The data part the journal keeps a line's mentioned part as. */
function mentionedPart(text: string): DataUIPart<UIDataTypes> {
  return { type: MENTIONED_PART_TYPE, data: { text } };
}

/** The journal's mentioned part, read back. */
const readMentionedPart = EffectSchema.decodeUnknownOption(
  EffectSchema.Struct({
    type: EffectSchema.Literal(MENTIONED_PART_TYPE),
    data: EffectSchema.Struct({ text: EffectSchema.String }),
  }),
);

/** The text of the journal's mentioned part, or nothing for any other part. */
function mentionedTextOf(part: UIMessage["parts"][number]): string | undefined {
  return Option.getOrUndefined(Option.map(readMentionedPart(part), (read) => read.data.text));
}

/** What was kept of an image a coding agent was handed: the conversation's picture it was kept as, by id, or why it was not kept. */
export type KeptImage = { readonly id: string } | { readonly omitted: PictureOmission };

/** A file as eve is handed it and the journal keeps it: an image with what was kept of it, where it was kept or refused. */
export type HandedFile = CodingAgentAttachment & { readonly kept?: KeptImage | undefined };

/** The provider key a file part keeps what was kept of its image under, which no provider reads. */
const KEPT_IMAGE_KEY = "luke";

/** What was kept of an image as its file part keeps it. */
const readKeptMetadata = EffectSchema.decodeUnknownOption(
  EffectSchema.Struct({
    [KEPT_IMAGE_KEY]: EffectSchema.Union([
      EffectSchema.Struct({ attachmentId: EffectSchema.String }),
      EffectSchema.Struct({ omitted: EffectSchema.Literals(Object.values(PICTURE_OMISSION)) }),
    ]),
  }),
);

/** An attachment's id as the store mints it. */
const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Why an image was not kept, in the words the agent reads after its name. */
const OMISSION_WORDS = {
  [PICTURE_OMISSION.LIMIT]: `this transcript already keeps ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION / 1_000_000} MB of pictures`,
  [PICTURE_OMISSION.TOO_LARGE]: `it is over ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB`,
  [PICTURE_OMISSION.UNSUPPORTED]: "it is no PNG, JPEG, or WebP whose header states its size",
} as const satisfies Record<PictureOmission, string>;

/** What was kept of an image as its file part keeps it. */
export function keptImageMetadata(kept: KeptImage): ProviderMetadata {
  return {
    [KEPT_IMAGE_KEY]: "id" in kept ? { attachmentId: kept.id } : { omitted: kept.omitted },
  };
}

/** What was kept of the image a file part carries, or nothing where it names none. */
export function keptImageOf(part: FileUIPart): KeptImage | undefined {
  const read = Option.getOrUndefined(readKeptMetadata(part.providerMetadata));
  if (read === undefined) return undefined;
  const kept = read[KEPT_IMAGE_KEY];
  return "attachmentId" in kept ? { id: kept.attachmentId } : { omitted: kept.omitted };
}

/** The line eve is handed right after an image: the attachment it was kept as, or why it was not kept. */
export function keptImageLine(name: string, kept: KeptImage): string {
  return "id" in kept
    ? `Image ${name} is attachment ${kept.id}`
    : `Image ${name} is not kept as an attachment: ${OMISSION_WORDS[kept.omitted]}`;
}

/** What a line eve was handed after the image of the name says was kept of it; nothing for any other text. */
export function keptImageOfLine(name: string, text: string): KeptImage | undefined {
  const lead = keptImageLine(name, { id: "" });
  if (text.startsWith(lead)) {
    const id = text.slice(lead.length);
    return ATTACHMENT_ID.test(id) ? { id } : undefined;
  }
  const omitted = Object.values(PICTURE_OMISSION).find(
    (omission) => text === keptImageLine(name, { omitted: omission }),
  );
  return omitted === undefined ? undefined : { omitted };
}

/** What heads a text file inlined for the model, before its name. */
const ATTACHED_FILE_HEADING = "Attached file: ";

/** The shortest fence a text file is inlined in, as Markdown's is. */
const SHORTEST_FENCE = 3;

/** An attachment's bytes as a `data:` URL, which both eve and the journal carry. */
export function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

/** The base64 of a `data:` URL, or nothing where it is not one. */
function base64Of(url: string): string | undefined {
  const comma = url.indexOf(",");
  return url.startsWith("data:") && comma >= 0 ? url.slice(comma + 1) : undefined;
}

/** An image or a PDF as a line is matched by it: its name and its type, which a receipt lists it by whether eve staged it or not. */
export function fileMark(filename: string | undefined, mediaType: string): string {
  return `[file: ${filename ?? ""} (${mediaType})]`;
}

/** A text file as the model reads it: its name, then the file in a fence longer than any run of backticks inside it. */
export function inlinedFile(name: string, text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/gu), (run) => run[0].length));
  const fence = "`".repeat(Math.max(SHORTEST_FENCE, longest + 1));
  return `${ATTACHED_FILE_HEADING}${name}\n${fence}\n${text}\n${fence}`;
}

/** The text a text file's base64 spells; the wire has already held it to UTF-8. */
export function textOf(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

/** The parts the journal keeps for a developer's line: the words, what it mentioned where it did, then each file it carried, in the order attached, an image naming what was kept of it. */
export function lineParts(
  text: string,
  attachments: readonly HandedFile[],
  mentioned?: string,
): (TextUIPart | FileUIPart | DataUIPart<UIDataTypes>)[] {
  return [
    { type: UI_PART_TYPE.TEXT, text, state: UI_PART_STATE.DONE },
    ...(mentioned === undefined ? [] : [mentionedPart(mentioned)]),
    ...attachments.map(
      (file): FileUIPart => ({
        type: "file",
        mediaType: file.mediaType,
        filename: file.name,
        url: dataUrl(file.mediaType, file.data),
        ...(file.kept === undefined
          ? undefined
          : { providerMetadata: keptImageMetadata(file.kept) }),
      }),
    ),
  ];
}

/**
 * A line's parts as eve's receipt lists them, in the order eve was handed
 * them: the words where there are any, what it mentioned, each text file
 * inlined, then each image and PDF by its mark, an image followed by the
 * line naming what was kept of it where it names that; nothing for a row
 * with no words part.
 */
export function receivedPartsOf(
  parts: readonly UIMessage["parts"][number][],
): readonly string[] | undefined {
  const [words, ...rest] = parts;
  if (words === undefined || !isTextUIPart(words)) return undefined;
  const files = rest.filter(isFileUIPart);
  const texts = files.flatMap((part) => {
    if (part.mediaType !== CODING_AGENT_ATTACHMENT_TYPE.TEXT) return [];
    const base64 = base64Of(part.url);
    return base64 === undefined ? [] : [inlinedFile(part.filename ?? "", textOf(base64))];
  });
  const marks = files.flatMap((part) => {
    if (part.mediaType === CODING_AGENT_ATTACHMENT_TYPE.TEXT) return [];
    const kept = keptImageOf(part);
    const mark = fileMark(part.filename, part.mediaType);
    return kept === undefined ? [mark] : [mark, keptImageLine(part.filename ?? "", kept)];
  });
  const mentioned = rest.flatMap((part) => mentionedTextOf(part) ?? []);
  return [...(words.text === "" ? [] : [words.text]), ...mentioned, ...texts, ...marks];
}

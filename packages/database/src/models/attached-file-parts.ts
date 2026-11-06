import { AGENT_ATTACHMENT_TYPE, type AgentAttachment } from "@repo/features/agent-wire";
import {
  CONVERSATION_PICTURE_BOUNDS,
  KEPT_IMAGE_PROVIDER_KEY,
  keptImageMetadataOf,
  PICTURE_OMISSION,
  type PictureOmission,
} from "@repo/features/conversation-picture-wire";
import { UI_PART_STATE, UI_PART_TYPE } from "@repo/features/turn-run";
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

export const MENTIONED_HEADING =
  "Mentioned in this message, as it stood when the message was sent:";

const MENTIONED_PART_TYPE = "data-ui-mentioned";

export function isMentionedText(text: string): boolean {
  return text.startsWith(MENTIONED_HEADING);
}

function mentionedPart(text: string): DataUIPart<UIDataTypes> {
  return { type: MENTIONED_PART_TYPE, data: { text } };
}

const readMentionedPart = EffectSchema.decodeUnknownOption(
  EffectSchema.Struct({
    type: EffectSchema.Literal(MENTIONED_PART_TYPE),
    data: EffectSchema.Struct({ text: EffectSchema.String }),
  }),
);

function mentionedTextOf(part: UIMessage["parts"][number]): string | undefined {
  return Option.getOrUndefined(Option.map(readMentionedPart(part), (read) => read.data.text));
}

export type KeptImage = { readonly id: string } | { readonly omitted: PictureOmission };

export type HandedFile = AgentAttachment & { readonly kept?: KeptImage | undefined };

const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const OMISSION_WORDS = {
  [PICTURE_OMISSION.LIMIT]: `this transcript already keeps ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES_PER_CONVERSATION / 1_000_000} MB of pictures`,
  [PICTURE_OMISSION.TOO_LARGE]: `it is over ${CONVERSATION_PICTURE_BOUNDS.MAX_BYTES / 1_000_000} MB`,
  [PICTURE_OMISSION.UNSUPPORTED]: "it is no PNG, JPEG, or WebP whose header states its size",
} as const satisfies Record<PictureOmission, string>;

export function keptImageMetadata(kept: KeptImage): ProviderMetadata {
  return {
    [KEPT_IMAGE_PROVIDER_KEY]: "id" in kept ? { attachmentId: kept.id } : { omitted: kept.omitted },
  };
}

export function keptImageOf(part: FileUIPart): KeptImage | undefined {
  const kept = keptImageMetadataOf(part.providerMetadata);
  if (kept === undefined) return undefined;
  return "attachmentId" in kept ? { id: kept.attachmentId } : { omitted: kept.omitted };
}

export function keptImageLine(name: string, kept: KeptImage): string {
  return "id" in kept
    ? `Image ${name} is attachment ${kept.id}`
    : `Image ${name} is not kept as an attachment: ${OMISSION_WORDS[kept.omitted]}`;
}

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

const ATTACHED_FILE_HEADING = "Attached file: ";

const SHORTEST_FENCE = 3;

export function dataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

function base64Of(url: string): string | undefined {
  const comma = url.indexOf(",");
  return url.startsWith("data:") && comma >= 0 ? url.slice(comma + 1) : undefined;
}

export function fileMark(filename: string | undefined, mediaType: string): string {
  return `[file: ${filename ?? ""} (${mediaType})]`;
}

export function inlinedFile(name: string, text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/gu), (run) => run[0].length));
  const fence = "`".repeat(Math.max(SHORTEST_FENCE, longest + 1));
  return `${ATTACHED_FILE_HEADING}${name}\n${fence}\n${text}\n${fence}`;
}

export function textOf(base64: string): string {
  return Buffer.from(base64, "base64").toString("utf8");
}

function keptUrl(file: HandedFile): string {
  return file.kept !== undefined && "id" in file.kept ? "" : dataUrl(file.mediaType, file.data);
}

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
        url: keptUrl(file),
        ...(file.kept === undefined
          ? undefined
          : { providerMetadata: keptImageMetadata(file.kept) }),
      }),
    ),
  ];
}

export function receivedPartsOf(
  parts: readonly UIMessage["parts"][number][],
): readonly string[] | undefined {
  const [words, ...rest] = parts;
  if (words === undefined || !isTextUIPart(words)) return undefined;
  const files = rest.filter(isFileUIPart);
  const texts = files.flatMap((part) => {
    if (part.mediaType !== AGENT_ATTACHMENT_TYPE.TEXT) return [];
    const base64 = base64Of(part.url);
    return base64 === undefined ? [] : [inlinedFile(part.filename ?? "", textOf(base64))];
  });
  const marks = files.flatMap((part) => {
    if (part.mediaType === AGENT_ATTACHMENT_TYPE.TEXT) return [];
    const kept = keptImageOf(part);
    const mark = fileMark(part.filename, part.mediaType);
    return kept === undefined ? [mark] : [mark, keptImageLine(part.filename ?? "", kept)];
  });
  const mentioned = rest.flatMap((part) => mentionedTextOf(part) ?? []);
  return [...(words.text === "" ? [] : [words.text]), ...mentioned, ...texts, ...marks];
}

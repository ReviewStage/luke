import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@luke/wire";
import { Option, Schema } from "effect";
import { AGENT_TOOL } from "./agent-tools.js";
import {
  type KeptPicture,
  keptPictureSchema,
  PICTURE_OMISSION,
  type PictureOmission,
} from "./conversation-picture-wire.js";

/**
 * agent-pictures-model.ts -- the pictures an agent's transcript names, read from its stored calls: the set a `show_image` call showed, the pictures an integration's call answered, and the screenshots a `browser` call took, each by the id the service kept it under.
 *
 * The service keeps a picture beside the transcript and writes its id in the
 * stored output in the bytes' place (`brain-host/relay-pictures.ts`,
 * `coder-host/show-image.ts`, `browser/browser-tool.ts`), so what is read here is ids, sizes, and
 * words; the bytes are read apart, through the window's picture cache. A
 * picture the service did not keep is named by why, with its size.
 */

const OMISSIONS: ReadonlySet<string> = new Set(Object.values(PICTURE_OMISSION));

/** The kinds of block an MCP tool answers that can carry a picture. */
const PICTURE_BLOCK = { IMAGE: "image", RESOURCE: "resource" } as const;

function isOmission(value: UnparsedWireValue): value is PictureOmission {
  return isWireString(value) && OMISSIONS.has(value);
}

const readKeptPicture = Schema.decodeUnknownOption(keptPictureSchema);

/** A kept picture as a stored output names it, or nothing for a value that is not one. */
function keptPictureOf(value: UnparsedWireValue): KeptPicture | undefined {
  return Option.getOrUndefined(readKeptPicture(value));
}

/** One picture of a set an agent showed: what it was kept as, once the call answered, and its words. */
export interface ShownPicture {
  readonly picture: KeptPicture | undefined;
  /** The file's name without its directory or extension, which the viewer saves it by where it has no caption. */
  readonly name: string;
  readonly caption: string;
}

function fileName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The pictures a `show_image` call showed, in order: each as the call asked for it, and as it was kept where the call answered. */
export function shownPicturesOf(
  input: UnparsedWireValue,
  output: UnparsedWireValue,
): readonly ShownPicture[] {
  const asked = isRecord(input) && Array.isArray(input.images) ? input.images : [];
  const kept = isRecord(output) && Array.isArray(output.pictures) ? output.pictures : [];
  return asked.flatMap((image: WireValue, index: number) => {
    if (!isRecord(image) || !isWireString(image.path)) return [];
    const caption = isWireString(image.caption) ? image.caption : "";
    return [{ picture: keptPictureOf(kept[index]), name: fileName(image.path), caption }];
  });
}

/** A picture an integration's call answered: kept, or named by why it was not. */
export type CalledPicture =
  | { readonly kept: true; readonly picture: KeptPicture; readonly name: string }
  | {
      readonly kept: false;
      readonly omitted: PictureOmission;
      readonly byteCount: number;
      readonly name: string;
    };

/** What a block names in a picture's place: the block itself, or a resource's own record. */
function pictureHolder(block: WireRecord): WireRecord | undefined {
  if (block.type === PICTURE_BLOCK.IMAGE) return block;
  if (block.type === PICTURE_BLOCK.RESOURCE && isRecord(block.resource)) return block.resource;
  return undefined;
}

/** What a browser call's screenshot is named by, before its place among the call's: `screenshot-1`. */
const SCREENSHOT_NAME = "screenshot";

/** The step a browser call's screenshot answers. */
const SCREENSHOT_ACTION = "screenshot";

/** A picture as a holder names it: kept, or not kept and why with its size; nothing where it names neither. */
function calledPicture(holder: WireRecord, name: string): CalledPicture | undefined {
  const picture = keptPictureOf(holder.picture);
  if (picture !== undefined) return { kept: true, picture, name };
  if (isOmission(holder.omitted) && isWireNumber(holder.byteCount)) {
    return { kept: false, omitted: holder.omitted, byteCount: holder.byteCount, name };
  }
  return undefined;
}

/** The screenshots a browser call took that the transcript names, in the order its steps took them. */
function screenshotsOf(output: UnparsedWireValue): readonly CalledPicture[] {
  if (!isRecord(output) || !Array.isArray(output.steps)) return [];
  const found: CalledPicture[] = [];
  for (const step of output.steps) {
    if (!isRecord(step) || step.action !== SCREENSHOT_ACTION) continue;
    const called = calledPicture(step, `${SCREENSHOT_NAME}-${String(found.length + 1)}`);
    if (called !== undefined) found.push(called);
  }
  return found;
}

/** The step a browser call's recording answers once stopped and kept. */
const STOP_RECORDING_ACTION = "stop_recording";

/** What a browser call's recording is named by where it has no caption, before its place among the call's: `recording-1`. */
const RECORDING_NAME = "recording";

/**
 * The videos a browser call recorded and the transcript kept, in the order
 * its steps stopped them, each with the caption it was stopped with; nothing
 * for any other call, or a recording not kept.
 */
export function recordedVideosOf(
  tool: string,
  output: UnparsedWireValue,
): readonly (ShownPicture & { readonly picture: KeptPicture })[] {
  if (tool !== AGENT_TOOL.BROWSER || !isRecord(output) || !Array.isArray(output.steps)) return [];
  const found: (ShownPicture & { readonly picture: KeptPicture })[] = [];
  for (const step of output.steps) {
    if (!isRecord(step) || step.action !== STOP_RECORDING_ACTION) continue;
    const picture = keptPictureOf(step.picture);
    if (picture === undefined) continue;
    const caption = isWireString(step.caption) ? step.caption : "";
    found.push({ picture, name: `${RECORDING_NAME}-${String(found.length + 1)}`, caption });
  }
  return found;
}

/**
 * The pictures a call answered, in order: a browser call's screenshots,
 * each named by its place (`screenshot-1`); an integration's pictures, each
 * named after the remote tool that answered it (`extract_images-1`), or the
 * call's own name where it names none; nothing for an output that is
 * neither, as every other call's is.
 */
export function calledPicturesOf(
  tool: string,
  input: UnparsedWireValue,
  output: UnparsedWireValue,
): readonly CalledPicture[] {
  if (tool === AGENT_TOOL.BROWSER) return screenshotsOf(output);
  if (!Array.isArray(output)) return [];
  const named = isRecord(input) && isWireString(input.remoteTool) ? input.remoteTool : tool;
  const found: CalledPicture[] = [];
  for (const block of output) {
    const holder = isRecord(block) ? pictureHolder(block) : undefined;
    if (holder === undefined) continue;
    const called = calledPicture(holder, `${named}-${String(found.length + 1)}`);
    if (called !== undefined) found.push(called);
  }
  return found;
}

/** Escapes the characters that would end a picture's words or address early, as the plan editor writes a picture (`picture-node.ts`). */
function escaped(words: string, ends: RegExp): string {
  return words.replace(ends, "\\$&");
}

/** A picture's line in a plan's text: its words as its alt text, and the plan's own address for it. */
export function taskPictureLine(words: string, address: string): string {
  return `![${escaped(words, /[\\[\]]/gu)}](${escaped(address, /[\\()]/gu)})`;
}

/** A picture's line added to a plan's text: the text as it then stands, and exactly what was added to it, which Undo takes back out. */
export interface PictureAddition {
  readonly text: string;
  readonly added: string;
}

/**
 * The plan's text with a picture's line at its end, a paragraph of its own.
 * Note that the text before it is kept byte for byte, because a trailing
 * space is a Markdown line break and a blank line is the developer's own;
 * only the line breaks the paragraph needs are added.
 */
export function withPictureLine(text: string, line: string): PictureAddition {
  const breaks = text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const added = `${breaks}${line}\n`;
  return { text: `${text}${added}`, added };
}

/** Whether the addition found at `at` still stands as a paragraph of its own: its line opening the text or after a blank line, and ending the text or a line. */
function standsAlone(text: string, at: number, added: string): boolean {
  const lineAt = at + (added.length - added.replace(/^\n+/u, "").length);
  const end = at + added.length;
  const opens = lineAt === 0 || text.slice(Math.max(0, lineAt - 2), lineAt) === "\n\n";
  const closes = end === text.length || text[end] === "\n";
  return opens && closes;
}

/**
 * The plan's text with an addition taken back out, as Undo takes back Add
 * to plan: its last occurrence still standing as a paragraph of its own,
 * exactly; nothing where none does. Note that a line the developer moved
 * into their words, or wrote straight under, is theirs now, and is left.
 */
export function withoutPictureLine(text: string, added: string): string | undefined {
  for (let at = text.lastIndexOf(added); at >= 0; at = text.lastIndexOf(added, at - 1)) {
    if (standsAlone(text, at, added)) return `${text.slice(0, at)}${text.slice(at + added.length)}`;
    if (at === 0) break;
  }
  return undefined;
}

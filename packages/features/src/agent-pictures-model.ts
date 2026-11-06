import {
  isRecord,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@repo/wire";
import { Option, Schema } from "effect";
import { AGENT_TOOL } from "./agent-tools.js";
import {
  type KeptPicture,
  keptPictureSchema,
  PICTURE_OMISSION,
  type PictureOmission,
} from "./conversation-picture-wire.js";

const OMISSIONS: ReadonlySet<string> = new Set(Object.values(PICTURE_OMISSION));

const PICTURE_BLOCK = { IMAGE: "image", RESOURCE: "resource" } as const;

function isOmission(value: UnparsedWireValue): value is PictureOmission {
  return isWireString(value) && OMISSIONS.has(value);
}

const readKeptPicture = Schema.decodeUnknownOption(keptPictureSchema);

function keptPictureOf(value: UnparsedWireValue): KeptPicture | undefined {
  return Option.getOrUndefined(readKeptPicture(value));
}

export interface ShownPicture {
  readonly picture: KeptPicture | undefined;
  readonly name: string;
  readonly caption: string;
}

function fileName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function asPictureList(input: UnparsedWireValue): UnparsedWireValue {
  return isRecord(input) && input.images === undefined && input.path !== undefined
    ? { images: [input] }
    : input;
}

export function shownPicturesOf(
  input: UnparsedWireValue,
  output: UnparsedWireValue,
): readonly ShownPicture[] {
  const list = asPictureList(input);
  const asked = isRecord(list) && Array.isArray(list.images) ? list.images : [];
  const kept = isRecord(output) && Array.isArray(output.pictures) ? output.pictures : [];
  return asked.flatMap((image: WireValue, index: number) => {
    if (!isRecord(image) || !isWireString(image.path)) return [];
    const caption = isWireString(image.caption) ? image.caption : "";
    return [{ picture: keptPictureOf(kept[index]), name: fileName(image.path), caption }];
  });
}

export type CalledPicture =
  | { readonly kept: true; readonly picture: KeptPicture; readonly name: string }
  | {
      readonly kept: false;
      readonly omitted: PictureOmission;
      readonly byteCount: number;
      readonly name: string;
    };

function pictureHolder(block: WireRecord): WireRecord | undefined {
  if (block.type === PICTURE_BLOCK.IMAGE) return block;
  if (block.type === PICTURE_BLOCK.RESOURCE && isRecord(block.resource)) return block.resource;
  return undefined;
}

const SCREENSHOT_NAME = "screenshot";

const SCREENSHOT_ACTION = "screenshot";

function calledPicture(holder: WireRecord, name: string): CalledPicture | undefined {
  const picture = keptPictureOf(holder.picture);
  if (picture !== undefined) return { kept: true, picture, name };
  if (isOmission(holder.omitted) && isWireNumber(holder.byteCount)) {
    return { kept: false, omitted: holder.omitted, byteCount: holder.byteCount, name };
  }
  return undefined;
}

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

const STOP_RECORDING_ACTION = "stop_recording";

const RECORDING_NAME = "recording";

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

function escaped(words: string, ends: RegExp): string {
  return words.replace(ends, "\\$&");
}

export function taskPictureLine(words: string, address: string): string {
  return `![${escaped(words, /[\\[\]]/gu)}](${escaped(address, /[\\()]/gu)})`;
}

export interface PictureAddition {
  readonly text: string;
  readonly added: string;
}

export function withPictureLine(text: string, line: string): PictureAddition {
  const breaks = text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const added = `${breaks}${line}\n`;
  return { text: `${text}${added}`, added };
}

function standsAlone(text: string, at: number, added: string): boolean {
  const lineAt = at + (added.length - added.replace(/^\n+/u, "").length);
  const end = at + added.length;
  const opens = lineAt === 0 || text.slice(Math.max(0, lineAt - 2), lineAt) === "\n\n";
  const closes = end === text.length || text[end] === "\n";
  return opens && closes;
}

export function withoutPictureLine(text: string, added: string): string | undefined {
  for (let at = text.lastIndexOf(added); at >= 0; at = text.lastIndexOf(added, at - 1)) {
    if (standsAlone(text, at, added)) return `${text.slice(0, at)}${text.slice(at + added.length)}`;
    if (at === 0) break;
  }
  return undefined;
}

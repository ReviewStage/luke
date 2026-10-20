import type { UnparsedWireValue } from "@luke/wire";
import { Schema } from "effect";

/**
 * chapters-model-choice.ts -- the Claude model a member's Generate chapters runs on, as Settings offers it and the service reads it.
 *
 * Each member picks it in Settings › Coding agents, and a Generate reads the
 * choice of the member who pressed it. The chapters stay the workspace's,
 * and the row they land in names the model that told them. Every choice
 * runs on Luke's own Anthropic key and outside the account's usage, so the
 * set is Claude's alone, at Anthropic's own ids (the ones an agent's title
 * model and the catalog's provider ids use). A stored value outside the set,
 * one a later build dropped or a row never written, reads as Haiku.
 */

/** The models a member may tell chapters on, at Anthropic's own ids. */
export const CHAPTERS_MODEL = {
  HAIKU: "claude-haiku-5-5",
  SONNET: "claude-sonnet-5-5",
  OPUS: "claude-opus-5-5",
} as const;

export type ChaptersModelId = (typeof CHAPTERS_MODEL)[keyof typeof CHAPTERS_MODEL];

/** Every choice, in the order a control offers them: fastest first. */
export const CHAPTERS_MODEL_LIST: readonly ChaptersModelId[] = [
  CHAPTERS_MODEL.HAIKU,
  CHAPTERS_MODEL.SONNET,
  CHAPTERS_MODEL.OPUS,
];

/** The model a member who never chose tells chapters on. */
export const CHAPTERS_MODEL_DEFAULT: ChaptersModelId = CHAPTERS_MODEL.HAIKU;

/** What a choice reads as on a control and beside the chapters it told. */
export const CHAPTERS_MODEL_LABEL = {
  [CHAPTERS_MODEL.HAIKU]: "Haiku 5.5",
  [CHAPTERS_MODEL.SONNET]: "Sonnet 5.5",
  [CHAPTERS_MODEL.OPUS]: "Opus 5.5",
} as const satisfies Record<ChaptersModelId, string>;

/** One of the choices, as the wire carries it. */
export const chaptersModelSchema = Schema.Literals(CHAPTERS_MODEL_LIST);

const readsChaptersModel = Schema.is(chaptersModelSchema);

/** Whether a value is one of the choices, as one arriving from storage or the wire is read. */
export function isChaptersModel(value: UnparsedWireValue): value is ChaptersModelId {
  return readsChaptersModel(value);
}

/** The choice a stored value stands for: itself where it is one, Haiku otherwise. */
export function chaptersModelFrom(stored: UnparsedWireValue): ChaptersModelId {
  return isChaptersModel(stored) ? stored : CHAPTERS_MODEL_DEFAULT;
}

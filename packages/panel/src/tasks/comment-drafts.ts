import { DRAFT_PLACE, type LineCommentPlace } from "../composer-drafts.js";
import type { DiffListSelection } from "../diff-view/contract.js";
import type { CommentLines } from "./changes-model.js";

export interface CommentDraft {
  readonly id: string;
  readonly picked: DiffListSelection;
  readonly lines: CommentLines;
}

export interface CommentDrafts {
  readonly open: readonly CommentDraft[];
  readonly lit: string | undefined;
}

export const NO_DRAFTS: CommentDrafts = { open: [], lit: undefined };

function endsAt(draft: CommentDraft, path: string, lines: CommentLines): boolean {
  return (
    draft.picked.path === path && draft.lines.side === lines.side && draft.lines.line === lines.line
  );
}

export function openDraft(
  drafts: CommentDrafts,
  picked: DiffListSelection,
  lines: CommentLines,
  id: string,
): CommentDrafts {
  const was = drafts.open.find((draft) => endsAt(draft, picked.path, lines));
  const draft = { id: was?.id ?? id, picked, lines };
  const open =
    was === undefined
      ? [...drafts.open, draft]
      : drafts.open.map((each) => (each === was ? draft : each));
  return { ...drafts, open, lit: draft.id };
}

export function closeDraft(drafts: CommentDrafts, id: string): CommentDrafts {
  const open = drafts.open.filter((draft) => draft.id !== id);
  return { ...drafts, open, lit: drafts.lit === id ? open.at(-1)?.id : drafts.lit };
}

export function lightDraft(drafts: CommentDrafts, id: string): CommentDrafts {
  return drafts.lit === id ? drafts : { ...drafts, lit: id };
}

export function lineCommentPlace(
  agentId: string,
  number: number | undefined,
  draft: CommentDraft,
): LineCommentPlace {
  const { side, line } = draft.lines;
  const place = { kind: DRAFT_PLACE.LINE_COMMENT, agentId, path: draft.picked.path, side, line };
  return number === undefined ? place : { ...place, number };
}

export interface HeldBodies {
  readonly of: (id: string) => string | undefined;
  readonly keep: (id: string, body: string | undefined) => void;
}

export function heldBodies(): HeldBodies {
  const held = new Map<string, string>();
  return {
    of: (id) => held.get(id),
    keep: (id, body) => {
      if (body === undefined) held.delete(id);
      else held.set(id, body);
    },
  };
}

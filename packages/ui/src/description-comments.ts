import { textChange } from "@repo/features/description-comment-anchor";
import {
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentActionRequest,
  type DescriptionCommentStart,
  type DescriptionCommentStartRequest,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import { createContext, useContext } from "react";

type CommentStarted = { readonly thread: DescriptionCommentThread } | { readonly note: string };

export interface DescriptionCommentsControl {
  readonly planId: string;
  readonly threads: readonly DescriptionCommentThread[];
  readonly read: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly notes: ReadonlyMap<string, string>;
  readonly start: (start: DescriptionCommentStart) => Promise<CommentStarted>;
  readonly act: (threadId: string, action: DescriptionCommentActionRequest) => Promise<boolean>;
}

export function openThread(thread: DescriptionCommentThread): boolean {
  return thread.status === DESCRIPTION_COMMENT_STATUS.OPEN;
}

const DescriptionCommentsContext = createContext<DescriptionCommentsControl | undefined>(undefined);

export const DescriptionCommentsProvider = DescriptionCommentsContext.Provider;

export function useDescriptionCommentsControl(): DescriptionCommentsControl | undefined {
  return useContext(DescriptionCommentsContext);
}

export interface CommentSpan {
  readonly from: number;
  readonly to: number;
  readonly thread: string;
  readonly active: boolean;
  readonly block: boolean;
}

export interface PendingThread {
  readonly from: number;
  readonly to: number;
  readonly scope: DescriptionCommentStartRequest["scope"];
  readonly quote: string;
  readonly text?: string;
}

export const PENDING_THREAD = "pending";

let laid:
  | { readonly from: string; readonly to: string; readonly change: ReturnType<typeof textChange> }
  | undefined;

function pendingIn(
  pending: PendingThread,
  descriptionText: string | undefined,
): PendingThread | undefined {
  if (
    pending.text === undefined ||
    descriptionText === undefined ||
    pending.text === descriptionText
  ) {
    return pending;
  }
  if (laid?.from !== pending.text || laid.to !== descriptionText) {
    laid = {
      from: pending.text,
      to: descriptionText,
      change: textChange(pending.text, descriptionText),
    };
  }
  const span = laid.change(pending);
  return span === undefined ? undefined : { ...pending, ...span };
}

export function commentSpansIn(
  threads: readonly DescriptionCommentThread[],
  section: { readonly from: number; readonly to: number },
  active: string | undefined,
  pending: PendingThread | undefined,
  descriptionText?: string,
): readonly CommentSpan[] {
  const begun = pending === undefined ? undefined : pendingIn(pending, descriptionText);
  const anchored = threads.flatMap((thread) =>
    thread.anchor !== undefined && openThread(thread)
      ? [
          {
            ...thread.anchor,
            thread: thread.id,
            block: thread.scope === DESCRIPTION_COMMENT_SCOPE.BLOCK,
          },
        ]
      : [],
  );
  const all =
    begun === undefined
      ? anchored
      : [
          ...anchored,
          {
            from: begun.from,
            to: begun.to,
            thread: PENDING_THREAD,
            block: begun.scope === DESCRIPTION_COMMENT_SCOPE.BLOCK,
          },
        ];
  return all.flatMap((span) => {
    const from = Math.max(span.from, section.from);
    const to = Math.min(span.to, section.to);
    if (from >= to) return [];
    return [
      {
        from: from - section.from,
        to: to - section.from,
        thread: span.thread,
        active: span.thread === active,
        block: span.block,
      },
    ];
  });
}

export interface MarginCard {
  readonly id: string;
  readonly top: number;
  readonly height: number;
}

export interface MarginView {
  readonly top: number;
  readonly bottom: number;
}

export function keptInView(top: number, height: number, view: MarginView): number {
  if (top + height <= view.bottom || top >= view.bottom) return top;
  return Math.max(Math.min(top, view.top), view.bottom - height);
}

export function hungTop(
  line: number,
  drop: number,
  height: number,
  gap: number,
  view: MarginView,
): number {
  const below = line + drop;
  if (below + height <= view.bottom || line < view.top || line >= view.bottom) return below;
  const above = line - gap - height;
  return above >= view.top ? above : Math.max(view.top, view.bottom - height);
}

export function marginTops(
  cards: readonly MarginCard[],
  active: string | undefined,
  gap: number,
  view?: MarginView,
): ReadonlyMap<string, number> {
  const sorted = [...cards].sort((a, b) => a.top - b.top);
  const tops = sorted.map((card) => card.top);
  const at = sorted.findIndex((card) => card.id === active);
  const open = sorted[at];
  if (open !== undefined && view !== undefined) {
    tops[at] = keptInView(open.top, open.height, view);
  }
  if (at >= 0) {
    for (let index = at + 1; index < sorted.length; index += 1) {
      const above = sorted[index - 1];
      const own = tops[index];
      const aboveTop = tops[index - 1];
      if (above !== undefined && own !== undefined && aboveTop !== undefined) {
        tops[index] = Math.max(own, aboveTop + above.height + gap);
      }
    }
    for (let index = at - 1; index >= 0; index -= 1) {
      const card = sorted[index];
      const own = tops[index];
      const belowTop = tops[index + 1];
      if (card !== undefined && own !== undefined && belowTop !== undefined) {
        tops[index] = Math.min(own, belowTop - card.height - gap);
      }
    }
  } else {
    for (let index = 1; index < sorted.length; index += 1) {
      const above = sorted[index - 1];
      const own = tops[index];
      const aboveTop = tops[index - 1];
      if (above !== undefined && own !== undefined && aboveTop !== undefined) {
        tops[index] = Math.max(own, aboveTop + above.height + gap);
      }
    }
  }
  return new Map(sorted.map((card, index) => [card.id, tops[index] ?? card.top]));
}

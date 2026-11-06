import type { ConversationEntry, ReviewThread } from "@repo/features/agent-wire";
import { pullRequestAddressOf } from "@repo/features/link-grammar";

export const ANCHOR_KIND = {
  THREAD: "thread",
  ENTRY: "entry",
} as const;

export type PullRequestAnchor =
  | { readonly kind: typeof ANCHOR_KIND.THREAD; readonly thread: ReviewThread }
  | { readonly kind: typeof ANCHOR_KIND.ENTRY; readonly entry: ConversationEntry };

const LINE_COMMENT = /^#(?:discussion_)?r(\d{1,20})$/u;

const ENTRY_FRAGMENT = /^#(?:issuecomment|pullrequestreview)-\d{1,20}$/u;

function fragmentOf(href: string): string {
  try {
    return new URL(href).hash;
  } catch {
    return "";
  }
}

function samePullRequest(href: string, pullRequestUrl: string): boolean {
  const there = pullRequestAddressOf(href);
  const here = pullRequestAddressOf(pullRequestUrl);
  return (
    there !== undefined &&
    here !== undefined &&
    there.number === here.number &&
    there.repository.toLowerCase() === here.repository.toLowerCase()
  );
}

export function anchorIn(
  href: string,
  pullRequestUrl: string,
  conversation: readonly ConversationEntry[],
): PullRequestAnchor | undefined {
  if (!samePullRequest(href, pullRequestUrl)) return undefined;
  const fragment = fragmentOf(href);
  const line = LINE_COMMENT.exec(fragment)?.[1];
  if (line !== undefined) {
    const named = `#discussion_r${line}`;
    const thread = conversation
      .flatMap((entry) => entry.threads ?? [])
      .find((each) => each.comments.some((comment) => fragmentOf(comment.url) === named));
    return thread === undefined ? undefined : { kind: ANCHOR_KIND.THREAD, thread };
  }
  if (!ENTRY_FRAGMENT.test(fragment)) return undefined;
  const entry = conversation.find((each) => fragmentOf(each.url) === fragment);
  return entry === undefined ? undefined : { kind: ANCHOR_KIND.ENTRY, entry };
}

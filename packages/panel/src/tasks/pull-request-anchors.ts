/**
 * pull-request-anchors.ts -- which of a pull request's own comments a link on GitHub names, so a press on it in the pull request's tab opens the comment there rather than GitHub.
 *
 * GitHub names a comment by its pull request's page and a fragment: a line
 * comment by `#discussion_r<id>` on the page, or `#r<id>` under its Files
 * tab; a comment on the pull request by `#issuecomment-<id>`; and a review by
 * `#pullrequestreview-<id>`. The conversation the tab read carries each
 * entry's and each thread comment's page in that very spelling, so a link is
 * matched against them as written, a reply naming its thread as its first
 * comment does. A link to another pull request, to the page with no
 * fragment, or to a comment the read did not reach, such as one of the
 * earlier entries left on GitHub, names nothing here, and opens on GitHub.
 */

import type { ConversationEntry, ReviewThread } from "@luke/features/coding-agent-wire";
import { pullRequestAddressOf } from "@luke/features/github-repositories-wire";

/** What a link to a pull request's own comment names: a review thread, or an entry of its conversation. */
export const ANCHOR_KIND = {
  THREAD: "thread",
  ENTRY: "entry",
} as const;

export type PullRequestAnchor =
  | { readonly kind: typeof ANCHOR_KIND.THREAD; readonly thread: ReviewThread }
  | { readonly kind: typeof ANCHOR_KIND.ENTRY; readonly entry: ConversationEntry };

/** A line comment's fragment: on the page, `#discussion_r<id>`, and under its Files tab, `#r<id>`. */
const LINE_COMMENT = /^#(?:discussion_)?r(\d{1,20})$/u;

/** A comment on the pull request's, or a review's, fragment. */
const ENTRY_FRAGMENT = /^#(?:issuecomment|pullrequestreview)-\d{1,20}$/u;

/** A link's fragment, `#` and all; empty for none, or for an address that does not read as one. */
function fragmentOf(href: string): string {
  try {
    return new URL(href).hash;
  } catch {
    return "";
  }
}

/** Whether two addresses are pages of the same pull request, whatever the case its owner and name are spelled in. */
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

/**
 * The comment of the pull request at `pullRequestUrl` that `href` names, as
 * its tab's `conversation` holds it: the thread a line comment of it stands
 * in, or the entry a comment on it or a review is; nothing for any other link.
 */
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

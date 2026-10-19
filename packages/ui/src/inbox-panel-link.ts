import { LINK_PLACE, readLink } from "@luke/features/luke-link";
import { decodeMention, MENTION_KIND, type MentionLines } from "@luke/features/mention-link";
import {
  type OpenedPullRequest,
  pullRequestAgentOf,
  repositoryPullRequestOf,
} from "./pull-request-link.js";

/**
 * inbox-panel-link.ts -- which links pressed on an Inbox item open in the panel beside it, and as what.
 *
 * The window's Inbox shows an item of any task in the task's place, with the
 * panel beside it standing for the item's task (`use-tasks-tab.ts`), so a
 * link the item names that the task's panel would open opens there, and the
 * developer stays on the item; any other leaves as the window opens it.
 */

/**
 * What the panel beside an Inbox item opens of a link pressed on the item:
 * a file of the task's repository, a page of the task, an agent's Pull
 * request tab as a Luke link names it, or that tab on its conversation as
 * the pull request's own page on GitHub names it, by its number where it is
 * another pull request of the task's repository.
 */
export const INBOX_PANEL_TARGET = {
  FILE: "file",
  PAGE: "page",
  CHANGES: "changes",
  PULL_REQUEST: "pull-request",
} as const;

export type InboxPanelTarget =
  | {
      readonly kind: typeof INBOX_PANEL_TARGET.FILE;
      readonly path: string;
      readonly lines: MentionLines | undefined;
    }
  | { readonly kind: typeof INBOX_PANEL_TARGET.PAGE; readonly pageId: string }
  | { readonly kind: typeof INBOX_PANEL_TARGET.CHANGES; readonly agentId: string }
  | {
      readonly kind: typeof INBOX_PANEL_TARGET.PULL_REQUEST;
      readonly agentId: string;
      /** The pull request's number, where it is one of the repository's none of the agents opened from the branch it stands on. */
      readonly number?: number;
    };

/** What holds the item: its task, none for an agent with no task, the task's repository, each of its agents' pull requests by its page on GitHub, and its agents, the first of which shows any other pull request of the repository. */
export interface InboxPanelPlace {
  readonly taskId: string | undefined;
  readonly repository: string | null;
  readonly pullRequests: readonly OpenedPullRequest[];
  readonly agentIds?: readonly string[] | undefined;
}

/**
 * What the panel beside the item opens of the link, or nothing where the
 * window opens it, leaving the Inbox or for the browser: a Luke link to a
 * page or an agent's Pull request tab of the item's own task, the page on
 * GitHub of a pull request one of its agents opened, or a file of the
 * task's repository on GitHub. Note that a file is the task's alone, since
 * the panel reads a file through the task it stands for.
 */
export function inboxPanelTarget(
  href: string,
  place: InboxPanelPlace,
): InboxPanelTarget | undefined {
  const link = readLink(href);
  if (link !== undefined) {
    const at = link.place;
    if (at.kind === LINK_PLACE.PAGE && at.planId === place.taskId) {
      return { kind: INBOX_PANEL_TARGET.PAGE, pageId: at.pageId };
    }
    if (at.kind === LINK_PLACE.CHANGES && at.planId === place.taskId) {
      return { kind: INBOX_PANEL_TARGET.CHANGES, agentId: at.agentId };
    }
    return undefined;
  }
  const agentId = pullRequestAgentOf(href, place.pullRequests);
  if (agentId !== undefined) {
    return { kind: INBOX_PANEL_TARGET.PULL_REQUEST, agentId };
  }
  if (place.taskId === undefined || place.repository === null) return undefined;
  const number = repositoryPullRequestOf(href, place.repository);
  const first = place.agentIds?.[0];
  if (number !== undefined) {
    return first === undefined
      ? undefined
      : { kind: INBOX_PANEL_TARGET.PULL_REQUEST, agentId: first, number };
  }
  const mention = decodeMention(href, place.repository);
  return mention?.kind === MENTION_KIND.FILE
    ? { kind: INBOX_PANEL_TARGET.FILE, path: mention.path, lines: mention.lines }
    : undefined;
}

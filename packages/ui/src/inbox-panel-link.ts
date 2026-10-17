import { LINK_PLACE, readLink } from "@luke/features/luke-link";
import { decodeMention, MENTION_KIND, type MentionLines } from "@luke/features/mention-link";

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
 * the pull request's own page on GitHub names it.
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
  | { readonly kind: typeof INBOX_PANEL_TARGET.PULL_REQUEST; readonly agentId: string };

/** What holds the item: its task, none for an agent with no task, the task's repository, and each of its agents' pull requests by its page on GitHub. */
export interface InboxPanelPlace {
  readonly taskId: string | undefined;
  readonly repository: string | null;
  readonly pullRequests: readonly { readonly agentId: string; readonly url: string }[];
}

/** A page's address without its fragment, its query, or a trailing slash, as two spellings of one pull request's page compare. */
function pageAddress(href: string): string {
  return href.replace(/[#?].*$/su, "").replace(/\/+$/u, "");
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
  const address = pageAddress(href);
  const opened = place.pullRequests.find((each) => pageAddress(each.url) === address);
  if (opened !== undefined) {
    return { kind: INBOX_PANEL_TARGET.PULL_REQUEST, agentId: opened.agentId };
  }
  if (place.taskId === undefined || place.repository === null) return undefined;
  const mention = decodeMention(href, place.repository);
  return mention?.kind === MENTION_KIND.FILE
    ? { kind: INBOX_PANEL_TARGET.FILE, path: mention.path, lines: mention.lines }
    : undefined;
}

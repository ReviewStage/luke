import {
  GITHUB_PAGE,
  LINK_PLACE,
  pullRequestAddressOf,
  readGitHubPage,
  readLink,
} from "./link-grammar.js";
import { parsedUrl } from "./parsed-url.js";

/**
 * lone-link.ts -- what a link standing alone in a paragraph of a message is drawn as: a pull request's card, a Luke page's, or the lines of a file at a commit; nothing for any other link, which stays the chip or link it is.
 *
 * Words drawn as a document, as an Inbox item's messages are, let a link
 * that is the only thing in its paragraph stand as a one-line card of what
 * it names, where the same link inside a sentence stays a chip. Three
 * kinds earn a card: a GitHub pull request, by its repository and number,
 * from its page or any page under it (`pullRequestAddressOf`); a page an
 * agent showed on a plan, by its Luke link (`link-grammar.ts`); and lines of
 * a file pinned to a commit, `https://github.com/<owner>/<name>/blob/<commit>/<path>#L3-L5`,
 * drawn as the Code tab draws them, its commit whole, since the lines are
 * read at it and a read takes no abbreviation. A file's link on a branch
 * names no lines that hold still, since a branch moves and its name may
 * hold a slash, so it is no card; nor is a link to anything else, a
 * commit abbreviated among them, which stays its chip. Nothing here
 * reads what a link names: the card does, through what the window
 * already reads.
 */

/** The kinds of card a lone link is drawn as. */
export const LONE_LINK = {
  PULL_REQUEST: "pull-request",
  PAGE: "page",
  CODE: "code",
} as const;

/**
 * A commit as a code card reads its lines at: forty hexadecimal digits,
 * since the File tab's read takes a whole commit and no abbreviation.
 */
const WHOLE_COMMIT = /^[0-9a-f]{40}$/u;

/** The most characters a link is read from; past this none of these is that long. */
const MAX_LINK_CHARS = 2_000;

/** What a lone link names, as its card is drawn from. */
export type LoneLink =
  | {
      readonly kind: typeof LONE_LINK.PULL_REQUEST;
      /** `owner/name`. */
      readonly repository: string;
      readonly number: number;
    }
  | {
      readonly kind: typeof LONE_LINK.PAGE;
      readonly taskId: string;
      readonly pageId: string;
    }
  | {
      readonly kind: typeof LONE_LINK.PAGE;
      /** The coding agent on no task the page stands on. */
      readonly agentId: string;
      readonly pageId: string;
    }
  | {
      readonly kind: typeof LONE_LINK.CODE;
      /** `owner/name`. */
      readonly repo: string;
      readonly path: string;
      readonly sha: string;
      readonly startLine: number;
      readonly endLine: number;
    };

/** The lines of a file at a whole commit a GitHub page names; nothing for any other page, a branch's among them. */
function codeLinesOf(target: string): LoneLink | undefined {
  const page = readGitHubPage(target);
  if (page?.kind !== GITHUB_PAGE.FILE || page.lines === undefined) return undefined;
  if (!WHOLE_COMMIT.test(page.ref)) return undefined;
  return {
    kind: LONE_LINK.CODE,
    repo: page.repository,
    path: page.path,
    sha: page.ref,
    startLine: page.lines.startLine,
    endLine: page.lines.endLine,
  };
}

/** What a link standing alone in its paragraph names as a card; nothing for a link that earns none. */
export function loneLinkOf(target: string): LoneLink | undefined {
  const url = target.length > MAX_LINK_CHARS ? undefined : parsedUrl(target);
  if (url === undefined) return undefined;
  const pullRequest = pullRequestAddressOf(target);
  if (pullRequest !== undefined) return { kind: LONE_LINK.PULL_REQUEST, ...pullRequest };
  const place = readLink(target)?.place;
  if (place?.kind === LINK_PLACE.PAGE) {
    return "planId" in place
      ? { kind: LONE_LINK.PAGE, taskId: place.planId, pageId: place.pageId }
      : { kind: LONE_LINK.PAGE, agentId: place.agentId, pageId: place.pageId };
  }
  return codeLinesOf(target);
}

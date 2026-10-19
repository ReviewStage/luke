import { pullRequestAddressOf } from "./github-repositories-wire.js";
import { LINK_PLACE, readLink } from "./luke-link.js";

/**
 * lone-link.ts -- what a link standing alone in a paragraph of a message is drawn as: a pull request's card, a Luke page's, or the lines of a file at a commit; nothing for any other link, which stays the chip or link it is.
 *
 * Words drawn as a document, as an Inbox item's messages are, let a link
 * that is the only thing in its paragraph stand as a one-line card of what
 * it names, where the same link inside a sentence stays a chip. Three
 * kinds earn a card: a GitHub pull request, by its repository and number,
 * from its page or any page under it (`pullRequestAddressOf`); a page an
 * agent showed on a plan, by its Luke link (`luke-link.ts`); and lines of
 * a file pinned to a commit, `https://github.com/<owner>/<name>/blob/<commit>/<path>#L3-L5`,
 * drawn as the Code tab draws them. A file's link on a branch names no
 * lines that hold still, since a branch moves and its name may hold a
 * slash, so it is no card; nor is a link to anything else. Nothing here
 * reads what a link names: the card does, through what the window
 * already reads.
 */

/** The kinds of card a lone link is drawn as. */
export const LONE_LINK = {
  PULL_REQUEST: "pull-request",
  PAGE: "page",
  CODE: "code",
} as const;

/** GitHub's own address, whose `/<owner>/<name>/blob/<commit>/<path>` pages are a file at a commit. */
const GITHUB_ORIGIN = "https://github.com";

/** The step before a file's commit in its GitHub page's path. */
const FILE_STEP = "blob";

/** A commit as a link pins one: seven to forty hexadecimal digits. */
const COMMIT = /^[0-9a-f]{7,40}$/u;

/** A GitHub page's lines: `#L3`, or `#L3-L5`. */
const LINES_FRAGMENT = /^#L(\d{1,9})(?:-L(\d{1,9}))?$/u;

/** An owner's or a repository's name as GitHub spells one. */
const REPOSITORY_STEP = /^[A-Za-z0-9_.-]{1,100}$/u;

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
      readonly kind: typeof LONE_LINK.CODE;
      /** `owner/name`. */
      readonly repo: string;
      readonly path: string;
      readonly sha: string;
      readonly startLine: number;
      readonly endLine: number;
    };

/** The address parsed, or nothing for text that is no URL; a constructor, since `URL.canParse` is missing from Safari before 17. */
function parsedUrl(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}

/** A path's step read back, or nothing where its encoding is broken. */
function decodedStep(step: string): string | undefined {
  try {
    return decodeURIComponent(step);
  } catch {
    return undefined;
  }
}

/** The lines of a file at a commit a GitHub page names; nothing for any other page, a branch's among them. */
function codeLinesOf(url: URL): LoneLink | undefined {
  if (url.origin !== GITHUB_ORIGIN) return undefined;
  const lines = LINES_FRAGMENT.exec(url.hash);
  const [first, owner, name, step, sha, ...encoded] = url.pathname.split("/");
  if (lines === null || first !== "" || step !== FILE_STEP || sha === undefined) return undefined;
  if (owner === undefined || !REPOSITORY_STEP.test(owner)) return undefined;
  if (name === undefined || !REPOSITORY_STEP.test(name) || !COMMIT.test(sha)) return undefined;
  const steps = encoded.map(decodedStep);
  // Note that a path is a file's, from the repository's root, and never climbs out of it.
  const whole = steps.every(
    (each): each is string => each !== undefined && each !== "" && each !== "." && each !== "..",
  );
  if (!whole || steps.length === 0) return undefined;
  const startLine = Number(lines[1]);
  const endLine = lines[2] === undefined ? startLine : Number(lines[2]);
  if (startLine < 1 || endLine < startLine) return undefined;
  return {
    kind: LONE_LINK.CODE,
    repo: `${owner}/${name}`,
    path: steps.join("/"),
    sha,
    startLine,
    endLine,
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
    return { kind: LONE_LINK.PAGE, taskId: place.planId, pageId: place.pageId };
  }
  return codeLinesOf(url);
}

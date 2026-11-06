import {
  GITHUB_PAGE,
  LINK_PLACE,
  pullRequestAddressOf,
  readGitHubPage,
  readLink,
} from "./link-grammar.js";
import { parsedUrl } from "./parsed-url.js";

export const LONE_LINK = {
  PULL_REQUEST: "pull-request",
  PAGE: "page",
  CODE: "code",
} as const;

const WHOLE_COMMIT = /^[0-9a-f]{40}$/u;

const MAX_LINK_CHARS = 2_000;

export type LoneLink =
  | {
      readonly kind: typeof LONE_LINK.PULL_REQUEST;
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
      readonly agentId: string;
      readonly pageId: string;
    }
  | {
      readonly kind: typeof LONE_LINK.CODE;
      readonly repo: string;
      readonly path: string;
      readonly sha: string;
      readonly startLine: number;
      readonly endLine: number;
    };

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

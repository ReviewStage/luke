/**
 * pull-request-link.ts -- which agent's pull request a link names, so a press on it opens the agent's Pull request tab rather than GitHub.
 *
 * A pull request an agent opened is named in words by its page on GitHub,
 * as a mention's chip or a bare link, and the window draws that pull
 * request in the agent's Pull request tab. A place that holds agents and
 * their pull requests (a task, the Inbox beside an item, an agent with no
 * task) asks this which one a link names, and opens its tab where it does.
 */

/** A pull request one of the place's agents opened, by its page on GitHub. */
export interface OpenedPullRequest {
  readonly agentId: string;
  readonly url: string;
}

/** A page's address without its fragment, its query, or a trailing slash, as two spellings of one pull request's page compare. */
function pageAddress(href: string): string {
  const cuts = [href.indexOf("#"), href.indexOf("?")].filter((at) => at >= 0);
  let address = cuts.length === 0 ? href : href.slice(0, Math.min(...cuts));
  // Note that the slashes are taken off one at a time rather than by a pattern, since a pattern anchored at the end backtracks over a long run of them.
  while (address.endsWith("/")) address = address.slice(0, -1);
  return address;
}

/** The agent that opened the pull request whose page the link is, however its address is spelled; nothing where none of them did. */
export function pullRequestAgentOf(
  href: string,
  pullRequests: Iterable<OpenedPullRequest>,
): string | undefined {
  const address = pageAddress(href);
  for (const each of pullRequests) {
    if (pageAddress(each.url) === address) return each.agentId;
  }
  return undefined;
}

import { pullRequestAddressOf } from "@luke/features/github-repositories-wire";

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

/** A listed task as the window holds it: its id, and the pull requests its row names, each with the agent that opened it where the service said. */
interface ListedTask {
  readonly id: string;
  readonly agents?:
    | {
        readonly pullRequests: readonly {
          readonly url?: string | undefined;
          readonly agentId?: string | undefined;
        }[];
      }
    | undefined;
}

/**
 * The task and the agent whose Pull request tab a link to a pull request
 * opens, among the tasks the window lists, wherever the link is pressed:
 * Factory, Chat, a task's card, or another task. Note that a task's row
 * names only its few newest pull requests, so an older one is not found here
 * and opens on GitHub.
 */
export function listedPullRequestOf(
  href: string,
  tasks: Iterable<ListedTask>,
): { readonly taskId: string; readonly agentId: string } | undefined {
  for (const task of tasks) {
    const opened = (task.agents?.pullRequests ?? []).flatMap(({ url, agentId }) =>
      url === undefined || agentId === undefined ? [] : [{ agentId, url }],
    );
    const agentId = pullRequestAgentOf(href, opened);
    if (agentId !== undefined) return { taskId: task.id, agentId };
  }
  return undefined;
}

/**
 * The number of the pull request of the repository given whose page on
 * GitHub the link is, or any page under it, whatever the case its owner and
 * name are spelled in; none for any other address, a pull request of another
 * repository among them. A place opens such a pull request in a Pull request
 * tab of one of its agents by its number, where none of them opened it from
 * the branch it stands on.
 */
export function repositoryPullRequestOf(
  href: string,
  repository: string | null | undefined,
): number | undefined {
  if (repository === null || repository === undefined) return undefined;
  const address = pullRequestAddressOf(href);
  return address !== undefined && address.repository.toLowerCase() === repository.toLowerCase()
    ? address.number
    : undefined;
}

import { pullRequestAddressOf } from "@repo/features/link-grammar";

export interface OpenedPullRequest {
  readonly agentId: string;
  readonly url: string;
}

function pageAddress(href: string): string {
  const cuts = [href.indexOf("#"), href.indexOf("?")].filter((at) => at >= 0);
  let address = cuts.length === 0 ? href : href.slice(0, Math.min(...cuts));
  while (address.endsWith("/")) address = address.slice(0, -1);
  return address;
}

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

interface ListedAgent {
  readonly id: string;
  readonly pullRequest?: { readonly url: string } | undefined;
}

export function listedPullRequestOf(
  href: string,
  tasks: Iterable<ListedTask>,
  agents: Iterable<ListedAgent> = [],
): { readonly taskId: string | undefined; readonly agentId: string } | undefined {
  for (const task of tasks) {
    const opened = (task.agents?.pullRequests ?? []).flatMap(({ url, agentId }) =>
      url === undefined || agentId === undefined ? [] : [{ agentId, url }],
    );
    const agentId = pullRequestAgentOf(href, opened);
    if (agentId !== undefined) return { taskId: task.id, agentId };
  }
  const taskless = [...agents].flatMap(({ id, pullRequest }) =>
    pullRequest === undefined ? [] : [{ agentId: id, url: pullRequest.url }],
  );
  const agentId = pullRequestAgentOf(href, taskless);
  return agentId === undefined ? undefined : { taskId: undefined, agentId };
}

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

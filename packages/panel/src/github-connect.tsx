import type { GitHubConnection } from "@repo/features/github-connection-wire";
import { createContext, useContext } from "react";

export interface GitHubConnectControl {
  readonly connection: GitHubConnection | undefined;
  readonly connect: () => Promise<boolean>;
  readonly disconnect: () => Promise<boolean>;
}

const GitHubConnectContext = createContext<GitHubConnectControl>({
  connection: undefined,
  connect: () => Promise.resolve(false),
  disconnect: () => Promise.resolve(false),
});

export const GitHubConnectProvider = GitHubConnectContext.Provider;

export function useGitHubConnection(): GitHubConnectControl {
  return useContext(GitHubConnectContext);
}

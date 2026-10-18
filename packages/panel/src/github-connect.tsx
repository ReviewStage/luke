import type { GitHubConnection } from "@luke/features/github-connection-wire";
import { createContext, useContext } from "react";

/**
 * github-connect.tsx -- the account's own GitHub, which lets agents use GitHub's tools as the developer, and the presses that connect and disconnect it.
 *
 * GitHub is connected apart from signing in, through a page of the
 * service's in the browser, so an account made with Google links GitHub
 * too; Settings › Integrations › GitHub is where it is connected and
 * disconnected. It grants GitHub's integration alone: a workspace's
 * repositories come from the GitHub installation connected to it. The
 * window's connection and its two presses are handed down on a context, as
 * `open-settings.tsx`'s opener is; outside the window, as in a test of one
 * surface, nothing is connected and neither press does anything.
 */

/** The account's GitHub as the window last read it, and the presses that connect and disconnect it. */
export interface GitHubConnectControl {
  readonly connection: GitHubConnection | undefined;
  /** Opens the connect page in the browser; answers whether it opened, a refusal saying why on its own. */
  readonly connect: () => Promise<boolean>;
  /** Disconnects it under the Mac's session; answers whether it did, a refusal saying why on its own. */
  readonly disconnect: () => Promise<boolean>;
}

const GitHubConnectContext = createContext<GitHubConnectControl>({
  connection: undefined,
  connect: () => Promise.resolve(false),
  disconnect: () => Promise.resolve(false),
});

/** Hands the window's GitHub connection and its presses to everything under it. */
export const GitHubConnectProvider = GitHubConnectContext.Provider;

/** The window's GitHub connection and its presses. */
export function useGitHubConnection(): GitHubConnectControl {
  return useContext(GitHubConnectContext);
}

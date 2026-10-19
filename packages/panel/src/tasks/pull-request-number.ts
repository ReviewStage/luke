import { tabKey } from "@luke/ui/tab-strip-model";
import { createContext, useContext } from "react";

/**
 * pull-request-number.ts -- which pull request a Pull request tab shows, where it names one by its number rather than following its agent's branch.
 *
 * A Pull request tab is an agent's (`ChangesStripTab`), and shows the pull
 * request from the branch the agent stands on, unless it names another of
 * the agent's repository by its number: one the agent opened before moving
 * to another branch, or one no agent opened. The tab hands its number down
 * here, so every read and change made under it, the Files changed view's,
 * a thread's, a reaction's, or a comment's, asks for that pull request
 * without each naming it on its own.
 */

const PullRequestNumberContext = createContext<number | undefined>(undefined);

/** Hands everything under it the number of the pull request its tab shows; none for the agent's own. */
export const PullRequestNumberProvider = PullRequestNumberContext.Provider;

/** The number of the pull request the tab this stands in shows, where it names one other than its agent's own. */
export function usePullRequestNumber(): number | undefined {
  return useContext(PullRequestNumberContext);
}

/** An agent's read or change as its act carries it: the agent, and the pull request's number where one is named. */
export function pullRequestAsked(
  agentId: string,
  number: number | undefined,
): { readonly agentId: string; readonly number?: number } {
  return number === undefined ? { agentId } : { agentId, number };
}

/** The key a pull request a tab names by its number is kept under, the tab's own (`tabKey`). */
export function numberedKey(agentId: string, number: number): string {
  return tabKey({ changes: agentId, number });
}

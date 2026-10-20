import type { GitHubRepositoryPullRequestAnswer } from "@luke/features";
import { Cache, Data, Duration, Effect, Exit } from "effect";

/**
 * pull-request-hold.ts -- the pull requests link chips name, read once for every window the host serves and held a while.
 *
 * Every chip and card that names a pull request asks the host for it as it
 * mounts, so a plan, a transcript, or an Inbox naming the same few pull
 * requests dozens of times asks for each dozens of times, and again on every
 * remount. Asks for one pull request of one workspace that arrive while a read
 * of it is out join that read, and its answer stands for every ask until it
 * lapses: a pull request the service drew for `PULL_REQUEST_HOLD.DRAWN`, and
 * one it drew none for, or did not answer, for the shorter
 * `PULL_REQUEST_HOLD.UNDRAWN`, so a repository the App comes to reach, or a
 * service that answers again, is drawn soon after. The hold is the host's, so
 * the desktop's panel, voice, and call windows and the web's tab share it.
 */

/** How long an answer stands before a pull request is read afresh. */
const PULL_REQUEST_HOLD = {
  /** A pull request the service drew. */
  DRAWN: Duration.seconds(60),
  /** None to draw, or no answer from the service: a refusal, held for less. */
  UNDRAWN: Duration.seconds(15),
  /** The most pull requests held at once; the least recently asked lapses first. */
  CAPACITY: 500,
} as const;

/** One pull request as a link asks for it: the workspace whose installation reaches it, its repository, and its number. */
class PullRequestKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}> {}

/** The service's answer for one pull request, or nothing where it did not answer. */
type PullRequestRead = GitHubRepositoryPullRequestAnswer | undefined;

/** The held read of pull requests over `read`, the service's own: an ask joins a read out for the same pull request, or is answered from the hold while it stands. */
export const holdPullRequestReads = (
  read: (
    place: { readonly workspaceId: string; readonly repository: string },
    number: number,
  ) => Effect.Effect<PullRequestRead>,
) =>
  Effect.map(
    Cache.makeWith(
      ({ workspaceId, repository, number }: PullRequestKey) =>
        read({ workspaceId, repository }, number),
      {
        capacity: PULL_REQUEST_HOLD.CAPACITY,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && exit.value?.pullRequest
            ? PULL_REQUEST_HOLD.DRAWN
            : PULL_REQUEST_HOLD.UNDRAWN,
      },
    ),
    (held) =>
      (
        place: { readonly workspaceId: string; readonly repository: string },
        number: number,
      ): Effect.Effect<PullRequestRead> =>
        Cache.get(
          held,
          new PullRequestKey({
            workspaceId: place.workspaceId,
            repository: place.repository,
            number,
          }),
        ),
  );

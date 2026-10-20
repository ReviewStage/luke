import { useAtom } from "@effect/atom-react";
import {
  type GitHubIssuePick,
  type GitHubRepositoryIssuesAnswer,
  githubIssueRefIn,
  type RepositoryIssuesAsk,
} from "@luke/features/github-repositories-wire";
import { matchesTokens, searchTokens } from "@luke/ui/search-tokens";
import { Duration, Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { useEffect, useRef, useState } from "react";
import { rendererRuntime } from "../renderer-runtime.js";
import type { TasksControl } from "./use-tasks-tab.js";

/**
 * github-issues-read.ts -- the GitHub issues New task's Issue chip offers: the chosen repository's open issues, what GitHub finds for the words typed, or the one issue a pasted key or link names.
 *
 * The repository's open issues are read as the menu's repository is first
 * known, again whenever it changes, and again each time the menu opens, so
 * issues granted on GitHub since are read, newest changed first. Words typed
 * filter those at once, and once the typing rests GitHub itself is searched
 * for them (`SEARCH_PAUSE`, which keeps the reads under GitHub's search
 * limit); `#N`, `owner/name#N`, or a link to an issue's page pasted asks
 * GitHub for that one issue instead, in the repository it names, which
 * need not be the chosen one, or none chosen at all. An installation that
 * has not granted the App issues answers so, with where its owner grants
 * them, rather than an empty list. A read refused finds nothing.
 */

/** How long the typing rests before GitHub is searched for the words as typed. */
const SEARCH_PAUSE = Duration.millis(250);

/** What the GitHub section of the menu stands as. */
export const GITHUB_ISSUES_STANDING = {
  /** Nothing to draw: no repository chosen or named, or GitHub not connected. */
  NONE: "none",
  LISTED: "listed",
  UNGRANTED: "ungranted",
} as const;

export type GitHubIssuesStanding =
  | { readonly kind: typeof GITHUB_ISSUES_STANDING.NONE }
  | {
      readonly kind: typeof GITHUB_ISSUES_STANDING.LISTED;
      readonly repository: string;
      readonly issues: readonly GitHubIssuePick[];
    }
  | {
      readonly kind: typeof GITHUB_ISSUES_STANDING.UNGRANTED;
      readonly repository: string;
      readonly settingsUrl: string;
    };

const NONE: GitHubIssuesStanding = { kind: GITHUB_ISSUES_STANDING.NONE };

/** One read's answer, and the workspace, repository, and words it was for. */
interface ReadAnswer {
  readonly workspaceId: string | undefined;
  readonly repository: string;
  readonly typed: string;
  readonly answer: GitHubRepositoryIssuesAnswer;
}

/** One ask of GitHub for the words as typed, and the read that asks it. */
interface IssueAsk {
  readonly workspaceId: string | undefined;
  readonly repository: string;
  readonly typed: string;
  readonly ask: RepositoryIssuesAsk;
  readonly read: (
    repository: string,
    ask: RepositoryIssuesAsk,
  ) => Promise<GitHubRepositoryIssuesAnswer>;
}

/** A read refused, or never answered, finds nothing. */
const FOUND_NOTHING: GitHubRepositoryIssuesAnswer = { issues: [] };

/**
 * A search once the typing has rested, as an atom whose work is the wait and
 * then the read: setting it again starts the wait over and lets go of the
 * read still out, so only the newest words are answered.
 */
const issueAskAtom = () =>
  rendererRuntime.fn((asked: IssueAsk) =>
    Effect.gen(function* () {
      yield* Effect.sleep(SEARCH_PAUSE);
      const answer = yield* Effect.tryPromise(() => asked.read(asked.repository, asked.ask)).pipe(
        Effect.orElseSucceed(() => FOUND_NOTHING),
      );
      const read: ReadAnswer = {
        workspaceId: asked.workspaceId,
        repository: asked.repository,
        typed: asked.typed,
        answer,
      };
      return read;
    }),
  );

/** The repository's open issues, read as the repository is known, again for another, and again on each opening; none while first read. */
function useOpenIssues(
  readIn: TasksControl["newTask"]["githubIssuesIn"],
  workspaceId: string | undefined,
  repository: string | null,
  opening: number,
): ReadAnswer | undefined {
  const [listed, setListed] = useState<ReadAnswer | undefined>(undefined);
  // Note that the reader is held through a ref, because the tab hands a new
  // one on every render and a read is owed to a repository, not a render.
  const latest = useRef(readIn);
  latest.current = readIn;
  const connected = readIn(workspaceId) !== undefined;
  useEffect(() => {
    const read = connected ? latest.current(workspaceId) : undefined;
    if (read === undefined || repository === null) return;
    let current = true;
    read(repository, {}).then(
      (answer) => {
        if (current) setListed({ workspaceId, repository, typed: "", answer });
      },
      () => {
        if (current) setListed({ workspaceId, repository, typed: "", answer: FOUND_NOTHING });
      },
    );
    // Note that each opening reads afresh, and a read let go answers nothing, so an older read never stands over a newer one.
    return () => {
      current = false;
    };
  }, [connected, workspaceId, repository, opening]);
  return listed !== undefined &&
    listed.workspaceId === workspaceId &&
    listed.repository === repository
    ? listed
    : undefined;
}

/** An answer as the section stands for a repository. */
function standingOf(
  repository: string,
  answer: GitHubRepositoryIssuesAnswer,
): GitHubIssuesStanding {
  return "ungranted" in answer
    ? {
        kind: GITHUB_ISSUES_STANDING.UNGRANTED,
        repository,
        settingsUrl: answer.ungranted.settingsUrl,
      }
    : { kind: GITHUB_ISSUES_STANDING.LISTED, repository, issues: answer.issues };
}

/** The open issues whose title or number holds every word typed, as a search would have them while GitHub's answer is out. */
function filtered(issues: readonly GitHubIssuePick[], typed: string): readonly GitHubIssuePick[] {
  const tokens = searchTokens(typed);
  return issues.filter((issue) => matchesTokens([issue.title, `#${issue.number}`], tokens));
}

/**
 * The GitHub issues the menu offers for the words typed so far, in the
 * repository chosen or the one a pasted key names, and the search to ask as
 * the words change. Nothing typed offers the open issues; words offer those
 * GitHub found for them once it answers, and until then the open issues
 * that hold them; a key or a link offers the one issue it names once GitHub
 * answers, and until then the open issue of that number where it is one.
 */
export function useGitHubIssues(
  readIn: TasksControl["newTask"]["githubIssuesIn"],
  workspaceId: string | undefined,
  repository: string | null,
  typed: string,
  opening: number,
): readonly [GitHubIssuesStanding, (typed: string) => void] {
  const listed = useOpenIssues(readIn, workspaceId, repository, opening);
  const [atom] = useState(issueAskAtom);
  const [searched, search] = useAtom(atom);
  const ask = (words: string) => {
    const read = readIn(workspaceId);
    const trimmed = words.trim();
    if (read === undefined || trimmed === "") return;
    const ref = githubIssueRefIn(trimmed, repository);
    if (ref !== undefined) {
      search({
        workspaceId,
        repository: ref.repository,
        typed: trimmed,
        ask: { number: ref.number },
        read,
      });
    } else if (repository !== null) {
      search({ workspaceId, repository, typed: trimmed, ask: { query: trimmed }, read });
    }
  };
  const words = typed.trim();
  const ref = words === "" ? undefined : githubIssueRefIn(words, repository);
  const place = ref?.repository ?? repository;
  if (readIn(workspaceId) === undefined || place === null) return [NONE, ask];
  const answered = AsyncResult.isSuccess(searched) ? searched.value : undefined;
  const current =
    answered !== undefined &&
    answered.workspaceId === workspaceId &&
    answered.repository === place &&
    answered.typed === words
      ? answered
      : undefined;
  // Note that with no repository chosen the section stands only for an issue a pasted key found.
  if (current !== undefined) {
    const standing = standingOf(place, current.answer);
    const found = standing.kind !== GITHUB_ISSUES_STANDING.LISTED || standing.issues.length > 0;
    return [repository !== null || found ? standing : NONE, ask];
  }
  // Note that what stands until GitHub answers is read off the open issues, where they are the repository's.
  const open = listed?.repository === place ? listed.answer : undefined;
  if (open === undefined) {
    return [
      ref === undefined
        ? { kind: GITHUB_ISSUES_STANDING.LISTED, repository: place, issues: [] }
        : NONE,
      ask,
    ];
  }
  if ("ungranted" in open || words === "") return [standingOf(place, open), ask];
  const issues =
    ref === undefined
      ? filtered(open.issues, words)
      : open.issues.filter((issue) => issue.number === ref.number);
  return [{ kind: GITHUB_ISSUES_STANDING.LISTED, repository: place, issues }, ask];
}

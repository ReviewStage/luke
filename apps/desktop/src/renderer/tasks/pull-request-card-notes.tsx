import type { GitHubPerson } from "@luke/features/coding-agent-wire";
import { HoverCardNote } from "@luke/ui";
import { githubActor } from "@luke/ui/actor-model";
import { GitCommitHorizontalIcon, MessageSquareIcon } from "lucide-react";
import { ActorLine, ActorRef } from "../actor-ref";
import { useMemberDirectory } from "../member-directory";
import { LinesChanged } from "./agent-published";
import { RelativeTime } from "./relative-time";
import { useMinute } from "./task-time";
import {
  PULL_REQUEST_MOMENT,
  type PullRequestMoment,
  type StandingPullRequest,
} from "./use-link-standing";

/**
 * pull-request-card-notes.tsx -- what a pull request's link card says under its title, as the workspace's GitHub App answered it: where it stands and its size, who opened it and how long ago it moved, its branches, its labels, and how many comments and commits it holds.
 *
 * Each line stands only where the service answered what it says, so a card
 * read from an older service, which answers none of it, says the key and
 * state alone, as it always did. Who opened it and how long ago share one
 * line, its opener by their face as the window names a GitHub account (a
 * GitHub issue's card draws the same line, without the time): "Opened by
 * [face] octo-dev · 3d ago" while it is open, and "Opened by [face]
 * octo-dev · merged 2h ago" once it settled, so the age is the one that
 * matters. Its branches stand as inline code does, and its comment and
 * commit counts each by its glyph. A label wears a dot of its own colour
 * beside its name, rather than its colour on its words, because GitHub lets
 * a label be any colour, a dark one among them, which the card's words could
 * not be read in; and a card names its first six labels and counts the
 * rest, so a pull request with many keeps a card short enough to stand in
 * the window.
 */

/** How a line of the card says a moment, at its start and after an author. */
const MOMENT_WORDS = {
  [PULL_REQUEST_MOMENT.OPENED]: { lead: "Opened", after: "" },
  [PULL_REQUEST_MOMENT.MERGED]: { lead: "Merged", after: "merged " },
  [PULL_REQUEST_MOMENT.CLOSED]: { lead: "Closed", after: "closed " },
} as const satisfies Record<PullRequestMoment, { lead: string; after: string }>;

/** What parts the pieces of a card's line. */
const SEPARATOR = " · ";

/** The most labels a card names, so one with many stays a card's height; the rest are counted in a last pill. */
const MAX_LABELS = 6;

/** GitHub's six hex digits for a label's colour, the one spelling a dot is painted in. */
const LABEL_COLOUR = /^[0-9a-f]{6}$/iu;

/** A count and the noun it counts, the noun in the plural unless the count is one. */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The first line: where it stands, and the lines it adds and removes across the files it changes. */
function SizeNote({
  heading,
  pullRequest,
}: {
  heading: string;
  pullRequest: StandingPullRequest;
}): React.JSX.Element {
  const { lines, files } = pullRequest;
  const filesWords = files === undefined ? undefined : counted(files, "file", "files");
  return (
    <HoverCardNote>
      {heading}
      {lines === undefined ? null : (
        <>
          {SEPARATOR}
          <LinesChanged additions={lines.additions} deletions={lines.deletions} />
        </>
      )}
      {filesWords === undefined
        ? null
        : lines === undefined
          ? `${SEPARATOR}${filesWords}`
          : ` in ${filesWords}`}
    </HoverCardNote>
  );
}

/**
 * Who opened a pull request or a GitHub issue, by their face and name as the
 * window names a GitHub account (a member's own where it is linked to one,
 * else their avatar), and how long ago it last moved after them where the
 * card says it; the time alone where GitHub named no one, and nothing where
 * the service answered neither.
 */
export function OpenedNote({
  opener,
  when,
}: {
  opener: GitHubPerson | undefined;
  when?: StandingPullRequest["when"];
}): React.JSX.Element | null {
  const now = useMinute();
  const { members, readerId, former } = useMemberDirectory();
  if (opener === undefined && when === undefined) return null;
  const words = when === undefined ? undefined : MOMENT_WORDS[when.moment];
  const ago = when === undefined ? null : <RelativeTime at={when.at} now={now} hint={false} ago />;
  if (opener === undefined) {
    return (
      <HoverCardNote>
        {`${words?.lead ?? ""} `}
        {ago}
      </HoverCardNote>
    );
  }
  const actor = githubActor(opener, { members, readerId, former });
  return (
    <HoverCardNote>
      <ActorLine>
        {"Opened by "}
        <ActorRef actor={actor} />
        {words === undefined ? null : (
          // Note that the time is one piece, so where a long login leaves it no room it moves under the name whole, rather than cutting the name.
          <span className="card-when">
            {`${SEPARATOR}${words.after}`}
            {ago}
          </span>
        )}
      </ActorLine>
    </HoverCardNote>
  );
}

/** How many comments and commits it holds, each by its glyph and its count, the noun after it in words a reader who cannot see the glyph hears. */
function CountsNote({
  comments,
  commits,
}: {
  comments: number | undefined;
  commits: number | undefined;
}): React.JSX.Element | null {
  if (comments === undefined && commits === undefined) return null;
  return (
    <p className="luke-hover-card-note card-counts">
      {comments === undefined ? null : (
        <span className="card-count">
          <MessageSquareIcon aria-hidden="true" />
          {comments}
          <span className="visually-hidden">{comments === 1 ? " comment" : " comments"}</span>
        </span>
      )}
      {commits === undefined ? null : (
        <span className="card-count">
          <GitCommitHorizontalIcon aria-hidden="true" />
          {commits}
          <span className="visually-hidden">{commits === 1 ? " commit" : " commits"}</span>
        </span>
      )}
    </p>
  );
}

/** A pull request's card notes under its title: each line where the service answered what it says. */
export function PullRequestCardNotes({
  heading,
  pullRequest,
  opener,
}: {
  /** Its key and the state it stands in, `relay#42 · Merged`. */
  heading: string;
  pullRequest: StandingPullRequest;
  /** Who opened it, where GitHub named them. */
  opener: GitHubPerson | undefined;
}): React.JSX.Element {
  const { branches, labels, comments, commits } = pullRequest;
  return (
    <>
      <SizeNote heading={heading} pullRequest={pullRequest} />
      <OpenedNote opener={opener} when={pullRequest.when} />
      {branches === undefined ? null : (
        <HoverCardNote oneLine>
          <code className="card-code">{branches.base}</code>
          {" ← "}
          <code className="card-code">{branches.head}</code>
        </HoverCardNote>
      )}
      {labels.length === 0 ? null : (
        <ul className="card-labels" aria-label="Labels">
          {labels.slice(0, MAX_LABELS).map((label) => (
            <li key={label.name} className="card-label">
              <span
                className="card-label-dot"
                aria-hidden="true"
                style={
                  LABEL_COLOUR.test(label.color) ? { background: `#${label.color}` } : undefined
                }
              />
              {label.name}
            </li>
          ))}
          {labels.length > MAX_LABELS ? (
            <li className="card-label">{`+${labels.length - MAX_LABELS}`}</li>
          ) : null}
        </ul>
      )}
      <CountsNote comments={comments} commits={commits} />
    </>
  );
}

import { CardNote } from "../hover-card";
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
 * line: "Opened by octo-dev · 3d ago" while it is open, and "Opened by
 * octo-dev · merged 2h ago" once it settled, so the age is the one that
 * matters. A label wears a dot of its own colour beside its name, rather
 * than its colour on its words, because GitHub lets a label be any colour,
 * a dark one among them, which the card's words could not be read in; and
 * a card names its first six labels and counts the rest, so a pull request
 * with many keeps a card short enough to stand in the window.
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
    <CardNote>
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
    </CardNote>
  );
}

/** Who opened it and how long ago it last moved, on one line; nothing where the service answered neither. */
function OpenedNote({
  pullRequest,
}: {
  pullRequest: StandingPullRequest;
}): React.JSX.Element | null {
  const now = useMinute();
  const { author, when } = pullRequest;
  if (author === undefined && when === undefined) return null;
  const by = author === undefined ? undefined : `Opened by ${author}`;
  if (when === undefined) return <CardNote>{by}</CardNote>;
  const words = MOMENT_WORDS[when.moment];
  const ago = <RelativeTime at={when.at} now={now} hint={false} ago />;
  return (
    <CardNote>
      {by === undefined ? (
        <>
          {`${words.lead} `}
          {ago}
        </>
      ) : (
        <>
          {`${by}${SEPARATOR}${words.after}`}
          {ago}
        </>
      )}
    </CardNote>
  );
}

/** A pull request's card notes under its title: each line where the service answered what it says. */
export function PullRequestCardNotes({
  heading,
  pullRequest,
}: {
  /** Its key and the state it stands in, `relay#42 · Merged`. */
  heading: string;
  pullRequest: StandingPullRequest;
}): React.JSX.Element {
  const { branches, labels, comments, commits } = pullRequest;
  const counts = [
    comments === undefined ? undefined : counted(comments, "comment", "comments"),
    commits === undefined ? undefined : counted(commits, "commit", "commits"),
  ].filter((words) => words !== undefined);
  return (
    <>
      <SizeNote heading={heading} pullRequest={pullRequest} />
      <OpenedNote pullRequest={pullRequest} />
      {branches === undefined ? null : (
        <CardNote oneLine>
          <code>{branches.base}</code>
          {" ← "}
          <code>{branches.head}</code>
        </CardNote>
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
      {counts.length === 0 ? null : <CardNote>{counts.join(SEPARATOR)}</CardNote>}
    </>
  );
}

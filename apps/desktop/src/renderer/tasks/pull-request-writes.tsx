import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
} from "@luke/features/coding-agent-view";
import {
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestAction,
  type PullRequestActionRequest,
} from "@luke/features/pull-request-write-wire";
import { ACT_KIND } from "@luke/host/acts";
import { Badge, CHIP_LOOK, Chip, ChipName, useMenu } from "@luke/ui";
import {
  CheckIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useAct } from "../act";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { useGitHubConnection } from "../github-connect";
import { Tooltip } from "../tooltip";
import { PULL_REQUEST_TONE, PullRequestMark } from "./pull-request-mark";

/**
 * pull-request-writes.tsx -- the changes a member makes to an agent's pull request from its Pull request tab, and what the tab says of each: the pill's menu of where the pull request stands, and the line under the bar where GitHub would not take one.
 *
 * Every change is one act (`CODING_AGENTS_PULL_REQUEST_ACTION`), which the
 * service makes on GitHub as the member pressing it, on their own GitHub
 * sign-in and never as the Luke GitHub App (`pull-request-write-wire.ts`).
 * One is out at a time; while it is, the controls that would send another
 * stand disabled. Once GitHub took it, or refused it, the tab's reads are
 * asked again (`onWritten`), so the bar and the page say where the pull
 * request stands now rather than what the press assumed. A refusal stands
 * on its own line under the bar until it is dismissed or the next change
 * is sent: GitHub's own words where GitHub refused the change, an offer to
 * sign in with GitHub again where it would not take the member's sign-in,
 * and Luke's own words where the change never reached GitHub.
 *
 * The pill is `@luke/ui`'s pill chip in the tone of where the pull request
 * stands, as stage-cli's status pill is, and opens a menu offering what may
 * be done from there: Ready for review for a draft and Convert to draft for
 * one open, each with Close pull request, neutral as GitHub draws it, and
 * Reopen pull request for one closed; once merged it is a badge in that
 * tone, with nothing left to press. The title is edited in place, as
 * stage-cli's is: its pencil opens a field over it, Enter or the check keeps
 * the words, and Escape or the cross keeps the title as it stood. The pill,
 * the title, and the line are drawn by whatever header the tab wears, so
 * they move with it.
 */

/** What each change says on the menu, and while it is out. */
const ACTION_WORDS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: "Ready for review",
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: "Convert to draft",
  [PULL_REQUEST_ACTION.SUBMIT_REVIEW]: "Submit review",
  [PULL_REQUEST_ACTION.REPLY_TO_THREAD]: "Reply",
  [PULL_REQUEST_ACTION.RESOLVE_THREAD]: "Resolve conversation",
  [PULL_REQUEST_ACTION.UNRESOLVE_THREAD]: "Unresolve conversation",
  [PULL_REQUEST_ACTION.MARK_FILE_VIEWED]: "Mark as viewed",
  [PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED]: "Unmark as viewed",
  [PULL_REQUEST_ACTION.MERGE]: "Merge",
  [PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE]: "Enable auto-merge",
  [PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE]: "Disable auto-merge",
  [PULL_REQUEST_ACTION.DEQUEUE]: "Remove from queue",
  [PULL_REQUEST_ACTION.CLOSE]: "Close pull request",
  [PULL_REQUEST_ACTION.REOPEN]: "Reopen pull request",
  [PULL_REQUEST_ACTION.EDIT_TITLE]: "Edit title",
} as const satisfies Record<PullRequestAction, string>;

/** The word for where the pull request stands, which the pill says. */
const STATE_WORDS = {
  [PULL_REQUEST_STATE.OPEN]: "Open",
  [PULL_REQUEST_STATE.DRAFT]: "Draft",
  [PULL_REQUEST_STATE.MERGED]: "Merged",
  [PULL_REQUEST_STATE.CLOSED]: "Closed",
} as const satisfies Record<PullRequestState, string>;

/** The line's own words. */
const WRITE_WORDS = {
  SIGN_IN: "Sign in with GitHub to make this change as you.",
  SIGN_IN_PRESS: "Sign in with GitHub",
  DISMISS: "Dismiss",
  /** GitHub's own words on a change it refused. */
  refused: (words: string) => `GitHub said: ${words}`,
} as const;

/** Luke's own words where a change never reached GitHub, by why. */
function failureWords(failure: CodingAgentCallFailure): string {
  switch (failure) {
    case CODING_AGENT_CALL_FAILURE.NOT_FOUND:
      return "This pull request can no longer be found.";
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
      return "Luke's GitHub App no longer reaches this repository.";
    default:
      return "Couldn't reach GitHub. Try again in a moment.";
  }
}

/** What the line under the bar says of the last change, where GitHub did not take it. */
const WRITE_NOTE = {
  SIGN_IN: "sign-in",
  WORDS: "words",
} as const;

export type WriteNote =
  | { readonly kind: typeof WRITE_NOTE.SIGN_IN }
  | { readonly kind: typeof WRITE_NOTE.WORDS; readonly words: string };

/** The tab's changes: the one out, if any, what the last one left to say, and the presses. */
export interface PullRequestWrites {
  /** The change out now; none while nothing is. */
  readonly pending: PullRequestAction | undefined;
  readonly note: WriteNote | undefined;
  /**
   * Sends the change; `onDone` hears once GitHub made it, so the press that
   * sent it can let go of what it held, and what it answers settles once
   * GitHub answered and what it said is drawn, as a merge's question waits.
   */
  readonly write: (request: PullRequestActionRequest, onDone?: () => void) => Promise<void>;
  readonly dismiss: () => void;
}

/** What an answer leaves to say: nothing where GitHub made the change. */
export function noteOf(
  answer: CodingAgentPullRequestWriteAnswerView | CodingAgentPullRequestViewedAnswerView,
): WriteNote | undefined {
  if ("failure" in answer) return { kind: WRITE_NOTE.WORDS, words: failureWords(answer.failure) };
  switch (answer.outcome) {
    case PULL_REQUEST_WRITE_OUTCOME.DONE:
      return undefined;
    case PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED:
      return { kind: WRITE_NOTE.SIGN_IN };
    case PULL_REQUEST_WRITE_OUTCOME.REFUSED:
      return { kind: WRITE_NOTE.WORDS, words: WRITE_WORDS.refused(answer.words) };
  }
}

/**
 * The agent's pull request's changes, one at a time, a press while one is
 * out doing nothing; once GitHub
 * answers, whether it took the change or refused it, `onWritten` asks the
 * tab's reads again.
 */
export function usePullRequestWrites(agentId: string, onWritten: () => void): PullRequestWrites {
  const { act } = useAct();
  const [pending, setPending] = useState<PullRequestAction | undefined>(undefined);
  const [note, setNote] = useState<WriteNote | undefined>(undefined);
  // Note that the one out is held in a ref as well, because two presses in one frame both read the state from before either.
  const out = useRef(false);
  const write = useCallback(
    (request: PullRequestActionRequest, onDone?: () => void) => {
      if (out.current) return Promise.resolve();
      out.current = true;
      setPending(request.action);
      setNote(undefined);
      return act(ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION, { agentId, request })
        .catch(
          (): CodingAgentPullRequestWriteAnswerView => ({
            failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
          }),
        )
        .then((answer) => {
          out.current = false;
          setPending(undefined);
          setNote(noteOf(answer));
          if (!("failure" in answer) && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE) {
            onDone?.();
          }
          // Note that a refusal may still have moved the pull request, so every answer from GitHub reads again.
          if (!("failure" in answer)) onWritten();
        });
    },
    [act, agentId, onWritten],
  );
  const dismiss = useCallback(() => setNote(undefined), []);
  return { pending, note, write, dismiss };
}

/** The changes the pill's menu offers: where the pull request stands, never a review. */
type StateAction =
  | typeof PULL_REQUEST_ACTION.READY_FOR_REVIEW
  | typeof PULL_REQUEST_ACTION.CONVERT_TO_DRAFT
  | typeof PULL_REQUEST_ACTION.CLOSE
  | typeof PULL_REQUEST_ACTION.REOPEN;

/** The changes the pill's menu offers from where the pull request stands. */
function actionsFrom(state: PullRequestState): readonly StateAction[] {
  switch (state) {
    case PULL_REQUEST_STATE.DRAFT:
      return [PULL_REQUEST_ACTION.READY_FOR_REVIEW, PULL_REQUEST_ACTION.CLOSE];
    case PULL_REQUEST_STATE.OPEN:
      return [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT, PULL_REQUEST_ACTION.CLOSE];
    case PULL_REQUEST_STATE.CLOSED:
      return [PULL_REQUEST_ACTION.REOPEN];
    case PULL_REQUEST_STATE.MERGED:
      return [];
  }
}

/** The glyph each change leads its item with. */
const ACTION_GLYPHS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: <GitPullRequestIcon aria-hidden="true" />,
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: <GitPullRequestDraftIcon aria-hidden="true" />,
  [PULL_REQUEST_ACTION.CLOSE]: <GitPullRequestClosedIcon aria-hidden="true" />,
  [PULL_REQUEST_ACTION.REOPEN]: <GitPullRequestIcon aria-hidden="true" />,
} as const satisfies Record<StateAction, React.JSX.Element>;

/**
 * The pill saying where the pull request stands, in its tone; a press
 * opens the changes that may be made from there, and a pull request merged
 * or closed is a badge.
 */
export function PullRequestStateMenu({
  pullRequest,
  writes,
}: {
  pullRequest: Pick<CodingAgentPullRequest, "number" | "state" | "checks">;
  writes: PullRequestWrites;
}): React.JSX.Element {
  const actions = actionsFrom(pullRequest.state);
  const menu = useMenu(actions.length > 0);
  const label = `Pull request ${STATE_WORDS[pullRequest.state]}`;
  const tone = PULL_REQUEST_TONE[pullRequest.state];
  const mark = <PullRequestMark pullRequest={pullRequest} />;
  if (actions.length === 0) {
    return (
      <Badge tone={tone} icon={mark}>
        {STATE_WORDS[pullRequest.state]}
      </Badge>
    );
  }
  const items: MenuAction[] = actions.map((action) => ({
    label: ACTION_WORDS[action],
    icon: ACTION_GLYPHS[action],
    disabled: writes.pending !== undefined,
    onSelect: () => writes.write({ action }),
  }));
  return (
    <>
      <Chip
        look={CHIP_LOOK.PILL}
        tone={tone}
        chevron
        aria-label={label}
        aria-busy={writes.pending !== undefined}
        disabled={writes.pending !== undefined}
        {...menu.trigger()}
      >
        {mark}
        <ChipName>
          {writes.pending === undefined
            ? STATE_WORDS[pullRequest.state]
            : `${ACTION_WORDS[writes.pending]}…`}
        </ChipName>
      </Chip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={[items]} onClose={menu.close} />
      )}
    </>
  );
}

/**
 * The line where GitHub did not take the last change: why, the sign-in
 * that mends it where that is why, and its dismissal. It stands under the
 * bar unless the control that sent the change draws it in its own place
 * (`className`), as the review panel does.
 */
export function PullRequestWriteNote({
  writes,
  className = "pull-request-write-note",
}: {
  /** What the last change left to say, and the door that lets it go: a tab's changes', or Files changed's viewed marks'. */
  writes: Pick<PullRequestWrites, "note" | "dismiss">;
  className?: string;
}): React.JSX.Element | null {
  const { connect } = useGitHubConnection();
  const { note, dismiss } = writes;
  if (note === undefined) return null;
  return (
    <p className={`failure-note ${className}`} role="alert">
      <span className="failure-note-words">
        {note.kind === WRITE_NOTE.SIGN_IN ? WRITE_WORDS.SIGN_IN : note.words}
      </span>
      {note.kind === WRITE_NOTE.SIGN_IN ? (
        <button
          type="button"
          className="toolbar-button bordered-button failure-note-remedy"
          onClick={() => void connect()}
        >
          {WRITE_WORDS.SIGN_IN_PRESS}
        </button>
      ) : null}
      <Tooltip label={WRITE_WORDS.DISMISS}>
        <button
          type="button"
          className="icon-button pull-request-write-dismiss"
          aria-label={WRITE_WORDS.DISMISS}
          onClick={dismiss}
        >
          <XIcon />
        </button>
      </Tooltip>
    </p>
  );
}

/** The title's own words. */
const TITLE_WORDS = {
  EDIT: "Edit title",
  SAVE: "Save title",
  CANCEL: "Cancel",
  FIELD: "Pull request title",
} as const;

/**
 * The pull request's title and number, its pencil opening a field over the
 * title where its words may be changed: kept on Enter or the check where
 * they changed and are not empty, given up on Escape or the cross. The field
 * stands until GitHub answers, and closes once it has.
 */
export function PullRequestTitle({
  title,
  number,
  writes,
}: {
  title: string;
  /** The pull request's number as the header says it. */
  number: string;
  writes: PullRequestWrites;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | undefined>(undefined);
  const busy = writes.pending !== undefined;
  const begin = () => setEditing(title);
  const keep = () => {
    const words = (editing ?? "").trim();
    if (words === "" || words === title) {
      setEditing(undefined);
      return;
    }
    void writes
      .write({ action: PULL_REQUEST_ACTION.EDIT_TITLE, title: words })
      .then(() => setEditing(undefined));
  };
  if (editing === undefined) {
    return (
      <h2 className="pull-request-title pull-request-title-editable">
        {title} <span className="pull-request-number">{number}</span>
        <Tooltip label={TITLE_WORDS.EDIT}>
          <button
            type="button"
            className="icon-button pull-request-title-edit"
            aria-label={TITLE_WORDS.EDIT}
            disabled={busy}
            onClick={begin}
          >
            <PencilIcon />
          </button>
        </Tooltip>
      </h2>
    );
  }
  return (
    <div className="pull-request-title pull-request-title-field">
      <input
        className="pull-request-title-input"
        // biome-ignore lint/a11y/noAutofocus: the field opens on a press of its pencil, which is where the keyboard is going.
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        aria-label={TITLE_WORDS.FIELD}
        value={editing}
        maxLength={PULL_REQUEST_WRITE_BOUNDS.MAX_TITLE_CHARS}
        disabled={busy}
        onChange={(event) => setEditing(event.target.value)}
        onKeyDown={(event) => {
          // Note that a key an input method takes to finish a word is the word's, not the field's.
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") keep();
          if (event.key === "Escape") {
            // The field's Escape gives the edit up and nothing more, so the window's own Escape never closes the page.
            event.preventDefault();
            event.stopPropagation();
            setEditing(undefined);
          }
        }}
      />
      <Tooltip label={TITLE_WORDS.SAVE}>
        <button
          type="button"
          className="icon-button"
          aria-label={TITLE_WORDS.SAVE}
          disabled={busy || editing.trim() === ""}
          onClick={keep}
        >
          <CheckIcon />
        </button>
      </Tooltip>
      <Tooltip label={TITLE_WORDS.CANCEL}>
        <button
          type="button"
          className="icon-button"
          aria-label={TITLE_WORDS.CANCEL}
          disabled={busy}
          onClick={() => setEditing(undefined)}
        >
          <XIcon />
        </button>
      </Tooltip>
    </div>
  );
}

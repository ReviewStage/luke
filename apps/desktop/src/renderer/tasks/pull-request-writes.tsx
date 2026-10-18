import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
  type CodingAgentPullRequestWriteAnswerView,
} from "@luke/features/coding-agent-view";
import {
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestAction,
  type PullRequestActionRequest,
} from "@luke/features/pull-request-write-wire";
import { ACT_KIND } from "@luke/host/acts";
import { ChevronDownIcon, GitPullRequestDraftIcon, GitPullRequestIcon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { useAct } from "../act";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { useGitHubConnection } from "../github-connect";
import { Tooltip } from "../tooltip";
import { PullRequestMark } from "./pull-request-mark";

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
 * The pill is the one control here so far, as stage-cli's status pill is:
 * it opens a menu offering what may be done from where the pull request
 * stands, Ready for review for a draft and Convert to draft for one open,
 * and stays a plain pill once it is merged or closed. It and the line are
 * drawn by whatever bar the tab wears, so they move with it.
 */

/** The changes the pill's own menu makes. */
type StateAction =
  | typeof PULL_REQUEST_ACTION.READY_FOR_REVIEW
  | typeof PULL_REQUEST_ACTION.CONVERT_TO_DRAFT;

/** What each of the pill's changes says on its menu. */
const ACTION_WORDS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: "Ready for review",
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: "Convert to draft",
<<<<<<< HEAD
} as const satisfies Record<StateAction, string>;

/** What the pill says while a change is out, whichever control sent it. */
const PENDING_WORDS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: "Marking ready",
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: "Converting to draft",
  [PULL_REQUEST_ACTION.MERGE]: "Merging",
  [PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE]: "Enabling auto-merge",
  [PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE]: "Disabling auto-merge",
  [PULL_REQUEST_ACTION.DEQUEUE]: "Leaving the queue",
=======
  [PULL_REQUEST_ACTION.SUBMIT_REVIEW]: "Submit review",
>>>>>>> origin/main
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

type WriteNote =
  | { readonly kind: typeof WRITE_NOTE.SIGN_IN }
  | { readonly kind: typeof WRITE_NOTE.WORDS; readonly words: string };

/** The tab's changes: the one out, if any, what the last one left to say, and the presses. */
export interface PullRequestWrites {
  /** The change out now; none while nothing is. */
  readonly pending: PullRequestAction | undefined;
  readonly note: WriteNote | undefined;
<<<<<<< HEAD
  /** Sends the change; settles once GitHub answered and what it said is drawn. */
  readonly write: (request: PullRequestActionRequest) => Promise<void>;
=======
  /** Sends the change; `onDone` hears once GitHub made it, so the press that sent it can let go of what it held. */
  readonly write: (request: PullRequestActionRequest, onDone?: () => void) => void;
>>>>>>> origin/main
  readonly dismiss: () => void;
}

/** What an answer leaves to say: nothing where GitHub made the change. */
function noteOf(answer: CodingAgentPullRequestWriteAnswerView): WriteNote | undefined {
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
 * The agent's pull request's changes, each sent once at a time; once GitHub
 * answers, whether it took the change or refused it, `onWritten` asks the
 * tab's reads again.
 */
export function usePullRequestWrites(agentId: string, onWritten: () => void): PullRequestWrites {
  const { act } = useAct();
  const [pending, setPending] = useState<PullRequestAction | undefined>(undefined);
  const [note, setNote] = useState<WriteNote | undefined>(undefined);
  const write = useCallback(
    (request: PullRequestActionRequest, onDone?: () => void) => {
      setPending(request.action);
      setNote(undefined);
      return act(ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION, { agentId, request })
        .catch(
          (): CodingAgentPullRequestWriteAnswerView => ({
            failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
          }),
        )
        .then((answer) => {
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
  | typeof PULL_REQUEST_ACTION.CONVERT_TO_DRAFT;

/** The changes the pill's menu offers from where the pull request stands. */
function actionsFrom(state: PullRequestState): readonly StateAction[] {
  switch (state) {
    case PULL_REQUEST_STATE.DRAFT:
      return [PULL_REQUEST_ACTION.READY_FOR_REVIEW];
    case PULL_REQUEST_STATE.OPEN:
      return [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT];
    default:
      return [];
  }
}

/** The glyph each change leads its item with. */
const ACTION_GLYPHS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: <GitPullRequestIcon aria-hidden="true" />,
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: <GitPullRequestDraftIcon aria-hidden="true" />,
} as const satisfies Record<StateAction, React.JSX.Element>;

/**
 * The pill saying where the pull request stands, in its colour; a press
 * opens the changes that may be made from there, and a pull request merged
 * or closed is a plain pill.
 */
export function PullRequestStateMenu({
  pullRequest,
  writes,
}: {
  pullRequest: Pick<CodingAgentPullRequest, "number" | "state" | "checks">;
  writes: PullRequestWrites;
}): React.JSX.Element {
  const actions = actionsFrom(pullRequest.state);
  const menu = useActionMenu(actions.length > 0);
  const label = `Pull request ${STATE_WORDS[pullRequest.state]}`;
  const inner = (
    <>
      <PullRequestMark pullRequest={pullRequest} />
      {writes.pending === undefined
        ? STATE_WORDS[pullRequest.state]
        : `${PENDING_WORDS[writes.pending]}…`}
    </>
  );
  if (actions.length === 0) {
    return (
      <span className="pull-request-state" data-pull-request-state={pullRequest.state}>
        {inner}
      </span>
    );
  }
  const items: MenuAction[] = actions.map((action) => ({
    label: ACTION_WORDS[action],
    icon: ACTION_GLYPHS[action],
    disabled: writes.pending !== undefined,
    onSelect: () => void writes.write({ action }),
  }));
  return (
    <>
      <button
        type="button"
        className="pull-request-state pull-request-state-button"
        data-pull-request-state={pullRequest.state}
        aria-label={label}
        aria-busy={writes.pending !== undefined}
        disabled={writes.pending !== undefined}
        {...menu.trigger()}
      >
        {inner}
        <ChevronDownIcon className="pull-request-state-chevron" aria-hidden="true" />
      </button>
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
  writes: PullRequestWrites;
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

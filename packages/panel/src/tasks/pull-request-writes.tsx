import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentPullRequestViewedAnswerView,
  type AgentPullRequestWriteAnswerView,
} from "@repo/features/agent-view";
import {
  type AgentPullRequest,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@repo/features/agent-wire";
import { saidWords } from "@repo/features/integration-health";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestAction,
  type PullRequestActionRequest,
  type PullRequestRefusal,
} from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SECTION, SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  Badge,
  BUTTON_SIZE,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  ChipName,
  COMMAND_LINK_ELEMENT,
  CONFIRM_LOSS,
  CommandLink,
  ConfirmDialog,
  type DialogQuestion,
  ErrorState,
  FailureNote,
  IconButton,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditEnd,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useConfirmDialog,
  useMenu,
} from "@repo/ui";
import type { ConfirmAct } from "@repo/ui/confirm-state";
import {
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  GLYPH,
} from "@repo/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { confirmFailure, failureShown } from "../failure-report.js";
import { useGitHubConnection } from "../github-connect.js";
import { OPEN_SETTINGS_LABEL, useOpenSettings } from "../open-settings.js";
import { useToast, useWithdrawToast } from "../toast.js";
import { PULL_REQUEST_STATE_LABEL, queuedLabel, REPOSITORY_UNREACHED_NOTE } from "./agent-model.js";
import { PULL_REQUEST_TONE, PullRequestMark } from "./pull-request-mark.js";
import { usePullRequestNumber } from "./pull-request-number.js";
import { agentPullRequestWrite, usePullRequestSource } from "./pull-request-source.js";
import { useOpenWorkspaceGitHub } from "./repository-remedy.js";

const ACTION_WORDS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: "Ready for review",
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: "Convert to draft",
  [PULL_REQUEST_ACTION.SUBMIT_REVIEW]: "Submit review",
  [PULL_REQUEST_ACTION.REPLY_TO_THREAD]: "Reply",
  [PULL_REQUEST_ACTION.RESOLVE_THREAD]: "Resolve conversation",
  [PULL_REQUEST_ACTION.UNRESOLVE_THREAD]: "Unresolve conversation",
  [PULL_REQUEST_ACTION.MARK_FILE_VIEWED]: "Mark as viewed",
  [PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED]: "Mark as not viewed",
  [PULL_REQUEST_ACTION.MERGE]: "Merge",
  [PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE]: "Enable auto-merge",
  [PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE]: "Disable auto-merge",
  [PULL_REQUEST_ACTION.DEQUEUE]: "Remove from queue",
  [PULL_REQUEST_ACTION.COMMENT]: "Comment",
  [PULL_REQUEST_ACTION.ADD_REVIEW_COMMENT]: "Comment on lines",
  [PULL_REQUEST_ACTION.DISCARD_REVIEW]: "Discard review",
  [PULL_REQUEST_ACTION.EDIT_REVIEW_COMMENT]: "Edit pending comment",
  [PULL_REQUEST_ACTION.DELETE_REVIEW_COMMENT]: "Delete pending comment",
  [PULL_REQUEST_ACTION.CLOSE]: "Close pull request",
  [PULL_REQUEST_ACTION.REOPEN]: "Reopen pull request",
  [PULL_REQUEST_ACTION.EDIT_TITLE]: "Edit title",
  [PULL_REQUEST_ACTION.EDIT_DESCRIPTION]: "Edit description",
  [PULL_REQUEST_ACTION.REQUEST_REVIEW]: "Request review",
  [PULL_REQUEST_ACTION.REMOVE_REVIEW_REQUEST]: "Remove review request",
  [PULL_REQUEST_ACTION.ADD_LABEL]: "Add label",
  [PULL_REQUEST_ACTION.REMOVE_LABEL]: "Remove label",
  [PULL_REQUEST_ACTION.ADD_REACTION]: "Add reaction",
  [PULL_REQUEST_ACTION.REMOVE_REACTION]: "Remove reaction",
} as const satisfies Record<PullRequestAction, string>;

const WRITE_WORDS = {
  SIGN_IN: "Sign in with GitHub to make this change as you.",
  SIGN_IN_PRESS: "Sign in with GitHub",
  DISMISS: "Dismiss",
  REFUSED: "GitHub refused this change.",
  SOURCE: "GitHub",
  UNREACHED: `${REPOSITORY_UNREACHED_NOTE} Choose which repositories ${PRODUCT_NAME} can see.`,
} as const;

function failureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This pull request can no longer be found.";
    case AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
      return WRITE_WORDS.UNREACHED;
    default:
      return "GitHub could not be reached. Try again in a moment.";
  }
}

export const WRITE_NOTE = {
  SIGN_IN: "sign-in",
  WORDS: "words",
} as const;

export type WriteNote =
  | { readonly kind: typeof WRITE_NOTE.SIGN_IN }
  | {
      readonly kind: typeof WRITE_NOTE.WORDS;
      readonly words: string;
      readonly said?: string | undefined;
      readonly reason?: PullRequestRefusal | undefined;
      readonly remedy?: WriteRemedy | undefined;
    };

export interface WritePlace {
  readonly taskId: string | null;
  readonly workspaceId?: string | undefined;
}

const WritePlaceContext = createContext<WritePlace | undefined>(undefined);

export const WritePlaceProvider = WritePlaceContext.Provider;

export const WRITE_REMEDY = {
  GITHUB_ACCESS: "github-access",
} as const;

export type WriteRemedy = (typeof WRITE_REMEDY)[keyof typeof WRITE_REMEDY];

export type WriteOutcome =
  | { readonly done: true }
  | { readonly done: false; readonly words: string; readonly note: WriteNote };

const NOT_SENT_WORDS = "Another change is on its way to GitHub.";
const NOT_SENT: WriteOutcome = {
  done: false,
  words: NOT_SENT_WORDS,
  note: { kind: WRITE_NOTE.WORDS, words: NOT_SENT_WORDS },
};

function noteWords(note: WriteNote): string {
  if (note.kind === WRITE_NOTE.SIGN_IN) return WRITE_WORDS.SIGN_IN;
  return note.said === undefined ? note.words : `${note.words}\n${note.said}`;
}

function outcomeOf(note: WriteNote | undefined): WriteOutcome {
  if (note === undefined) return { done: true };
  return { done: false, words: noteWords(note), note };
}

export type ReadAgain = () => unknown;

export interface PullRequestWrites {
  readonly pending: PullRequestAction | undefined;
  readonly note: WriteNote | undefined;
  readonly write: (request: PullRequestActionRequest, onDone?: () => void) => Promise<WriteOutcome>;
  readonly dismiss: () => void;
  readonly confirmAct: (request: PullRequestActionRequest) => ConfirmAct;
}

function refusalOf(outcome: WriteOutcome): ActionResult | undefined {
  return outcome.done
    ? undefined
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: outcome.words };
}

export function noteOf(
  answer: AgentPullRequestWriteAnswerView | AgentPullRequestViewedAnswerView,
): WriteNote | undefined {
  if ("failure" in answer) {
    return answer.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE
      ? {
          kind: WRITE_NOTE.WORDS,
          words: failureWords(answer.failure),
          remedy: WRITE_REMEDY.GITHUB_ACCESS,
        }
      : { kind: WRITE_NOTE.WORDS, words: failureWords(answer.failure) };
  }
  switch (answer.outcome) {
    case PULL_REQUEST_WRITE_OUTCOME.DONE:
      return undefined;
    case PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED:
      return { kind: WRITE_NOTE.SIGN_IN };
    case PULL_REQUEST_WRITE_OUTCOME.REFUSED:
      return {
        kind: WRITE_NOTE.WORDS,
        words: WRITE_WORDS.REFUSED,
        said: saidWords(WRITE_WORDS.SOURCE, answer.words),
        reason: "reason" in answer ? answer.reason : undefined,
      };
  }
}

export function usePullRequestWrites(agentId: string, onWritten: ReadAgain): PullRequestWrites {
  const number = usePullRequestNumber();
  const source = usePullRequestSource();
  const send = source?.write ?? agentPullRequestWrite(agentId, number);
  const queryClient = useQueryClient();
  const mutationKey = useMemo(
    () => [ACT_KIND.AGENTS_PULL_REQUEST_ACTION, agentId, number] as const,
    [agentId, number],
  );
  const change = useMutation({
    mutationKey,
    scope: { id: agentId },
    mutationFn: async (request: PullRequestActionRequest) => {
      const answer = await send(request).catch(
        (): AgentPullRequestWriteAnswerView => ({ failure: AGENT_CALL_FAILURE.UNANSWERED }),
      );
      if (!("failure" in answer)) await Promise.resolve(onWritten()).catch(() => undefined);
      return { answer, note: noteOf(answer) };
    },
  });
  const { mutateAsync, reset } = change;
  const out = useRef(false);
  const [unsent, setUnsent] = useState<PullRequestAction | undefined>(undefined);
  const write = useCallback(
    async (request: PullRequestActionRequest, onDone?: () => void) => {
      if (out.current || queryClient.isMutating({ mutationKey }) > 0) return NOT_SENT;
      out.current = true;
      const { answer, note } = await mutateAsync(request).finally(() => {
        out.current = false;
      });
      if (!("failure" in answer) && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE) {
        onDone?.();
      }
      return outcomeOf(note);
    },
    [mutateAsync, queryClient, mutationKey],
  );
  const pending = change.isPending ? change.variables.action : undefined;
  const note = change.data?.note;
  const confirmAct = (request: PullRequestActionRequest): ConfirmAct => {
    const asked = change.variables?.action === request.action;
    return {
      run: () => {
        setUnsent(undefined);
        return write(request).then((outcome) => {
          if (outcome === NOT_SENT) setUnsent(request.action);
        });
      },
      busy: change.isPending && asked,
      refused:
        unsent === request.action
          ? refusalOf(NOT_SENT)
          : !change.isPending && asked && change.data !== undefined
            ? refusalOf(outcomeOf(change.data.note))
            : undefined,
      reset: () => {
        setUnsent(undefined);
        reset();
      },
    };
  };
  return { pending, note, write, dismiss: reset, confirmAct };
}

type StateAction =
  | typeof PULL_REQUEST_ACTION.READY_FOR_REVIEW
  | typeof PULL_REQUEST_ACTION.CONVERT_TO_DRAFT
  | typeof PULL_REQUEST_ACTION.CLOSE
  | typeof PULL_REQUEST_ACTION.REOPEN;

function actionsFrom(state: PullRequestState, queued: boolean): readonly StateAction[] {
  if (queued && state === PULL_REQUEST_STATE.OPEN) return [PULL_REQUEST_ACTION.CLOSE];
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

const ACTION_GLYPHS = {
  [PULL_REQUEST_ACTION.READY_FOR_REVIEW]: <GitPullRequestIcon aria-hidden="true" />,
  [PULL_REQUEST_ACTION.CONVERT_TO_DRAFT]: <GitPullRequestDraftIcon aria-hidden="true" />,
  [PULL_REQUEST_ACTION.CLOSE]: <GitPullRequestClosedIcon aria-hidden="true" />,
  [PULL_REQUEST_ACTION.REOPEN]: <GitPullRequestIcon aria-hidden="true" />,
} as const satisfies Record<StateAction, React.JSX.Element>;

export const QUEUE_WARNING =
  "Removing this pull request from the queue could impact other pull requests in the queue.";

const CLOSE_QUEUED_QUESTION: DialogQuestion = {
  title: "Close this pull request?",
  body: `Closing it takes it out of the merge queue, and reopening it does not queue it again. ${QUEUE_WARNING}`,
  verb: ACTION_WORDS[PULL_REQUEST_ACTION.CLOSE],
  running: "Closing",
  loss: CONFIRM_LOSS.AFFECTS_OTHERS,
  replayUnmasked: true,
};

const CLOSE_UNKNOWN_QUESTION: DialogQuestion = {
  ...CLOSE_QUEUED_QUESTION,
  body: `Could not read whether this pull request is in the merge queue. If it is, closing it takes it out, and reopening it does not queue it again. ${QUEUE_WARNING}`,
};

const CLOSED_TOAST = {
  WORDS: "Pull request closed",
  REOPEN: "Reopen",
} as const;

export function PullRequestStateMenu({
  pullRequest,
  queued,
  shown = true,
  writes,
}: {
  pullRequest: Pick<AgentPullRequest, "number" | "state" | "checks">;
  queued?: { readonly position?: number | undefined } | null | undefined;
  shown?: boolean;
  writes: PullRequestWrites;
}): React.JSX.Element {
  const inQueue =
    queued !== null && queued !== undefined && pullRequest.state === PULL_REQUEST_STATE.OPEN;
  const actions = actionsFrom(pullRequest.state, inQueue);
  const menu = useMenu(actions.length > 0);
  const toast = useToast();
  const withdrawToast = useWithdrawToast();
  const toastSubject = useId();
  const newestWrites = useRef(writes);
  newestWrites.current = writes;
  const [asked, setAsked] = useState(false);
  const unread = queued === undefined && pullRequest.state === PULL_REQUEST_STATE.OPEN;
  const mayBeQueued = inQueue || unread;
  const confirm = useConfirmDialog(
    { subject: asked && mayBeQueued, surfaceOpen: shown },
    writes.confirmAct({ action: PULL_REQUEST_ACTION.CLOSE }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_DEQUEUE),
  );
  if ((!shown || !mayBeQueued) && asked && !confirm.busy) setAsked(false);
  const words = inQueue
    ? queuedLabel(queued.position)
    : PULL_REQUEST_STATE_LABEL[pullRequest.state];
  const shownWords = writes.pending === undefined ? words : `${ACTION_WORDS[writes.pending]}…`;
  const label = `Pull request ${shownWords}`;
  const tone = inQueue ? STATUS_TONE.ATTENTION : PULL_REQUEST_TONE[pullRequest.state];
  const mark = (
    <PullRequestMark
      pullRequest={{
        number: pullRequest.number,
        state: pullRequest.state,
        checks: pullRequest.checks,
        ...(inQueue ? { queued: true } : undefined),
      }}
    />
  );
  if (actions.length === 0) {
    return (
      <Badge tone={tone} icon={mark}>
        {words}
      </Badge>
    );
  }
  const select = (action: StateAction) => {
    if (action === PULL_REQUEST_ACTION.REOPEN) withdrawToast(toastSubject);
    if (action === PULL_REQUEST_ACTION.CLOSE && mayBeQueued) {
      setAsked(true);
      confirm.ask();
      return;
    }
    void writes.write(
      { action },
      action === PULL_REQUEST_ACTION.CLOSE
        ? () =>
            toast({
              replayUnmasked: true,
              words: CLOSED_TOAST.WORDS,
              tone: STATUS_TONE.COMPLETE,
              subject: toastSubject,
              action: {
                label: CLOSED_TOAST.REOPEN,
                replayUnmasked: true,
                onPress: () =>
                  void newestWrites.current.write({ action: PULL_REQUEST_ACTION.REOPEN }),
              },
            })
        : undefined,
    );
  };
  const items: MenuAction[] = actions.map((action) => ({
    label: ACTION_WORDS[action],
    icon: ACTION_GLYPHS[action],
    danger: action === PULL_REQUEST_ACTION.CLOSE,
    disabled: writes.pending !== undefined,
    onSelect: () => select(action),
  }));
  return (
    <>
      <Chip
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        tone={tone}
        chevron
        aria-label={label}
        aria-busy={writes.pending !== undefined}
        disabled={writes.pending !== undefined}
        {...menu.trigger()}
      >
        {mark}
        <ChipName>{shownWords}</ChipName>
      </Chip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={label}
          menu={menu.drawn}
          groups={[items]}
          onClose={menu.close}
        />
      )}
      <ConfirmDialog
        open
        confirm={confirm}
        question={inQueue ? CLOSE_QUEUED_QUESTION : CLOSE_UNKNOWN_QUESTION}
      />
    </>
  );
}

export function PullRequestWriteNote({
  writes,
  className = "pull-request-write-note flex-none border-b border-border py-tight-gap pr-column-inset pl-content-inset",
}: {
  writes: Pick<PullRequestWrites, "note" | "dismiss">;
  className?: string;
}): React.JSX.Element | null {
  const { connect } = useGitHubConnection();
  const openSettings = useOpenSettings();
  const openWorkspaceGitHub = useOpenWorkspaceGitHub();
  const place = useContext(WritePlaceContext);
  const openAccess = () =>
    place?.taskId === null || place?.taskId === undefined
      ? openSettings({
          page: SETTINGS_VIEW.WORKSPACE,
          section: SETTINGS_SECTION.GITHUB_REPOSITORIES,
          ...(place?.workspaceId === undefined ? undefined : { workspaceId: place.workspaceId }),
        })
      : openWorkspaceGitHub(place.taskId);
  const { note, dismiss } = writes;
  if (note === undefined) return null;
  const failure = failureShown({
    surface: FAILURE_SURFACE.PULL_REQUEST_WRITE,
    cause: note,
    refused: true,
  });
  return (
    <div className={className}>
      {note.kind === WRITE_NOTE.SIGN_IN ? (
        <ErrorState
          remedy={{ label: WRITE_WORDS.SIGN_IN_PRESS, onClick: () => void connect() }}
          onDismiss={dismiss}
          failure={failure}
        >
          {WRITE_WORDS.SIGN_IN}
        </ErrorState>
      ) : note.remedy === WRITE_REMEDY.GITHUB_ACCESS ? (
        <ErrorState
          remedy={{ label: OPEN_SETTINGS_LABEL, onClick: openAccess }}
          onDismiss={dismiss}
          failure={failure}
        >
          {note.words}
        </ErrorState>
      ) : (
        <FailureNote
          failure={failure}
          also={<IconButton icon={<GLYPH.CLOSE />} label={WRITE_WORDS.DISMISS} onClick={dismiss} />}
        >
          {noteWords(note)}
        </FailureNote>
      )}
    </div>
  );
}

const TITLE_WORDS = {
  EDIT: "Edit title",
  OPEN: "⌘-click the title to open on GitHub",
  FIELD: "Pull request title",
} as const;

export function PullRequestTitleLine({
  field = false,
  children,
}: {
  field?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.H2}
      variant={TEXT_VARIANT.DIALOG}
      className={field ? "pull-request-title pull-request-title-field" : "pull-request-title"}
    >
      {children}
    </Text>
  );
}

export function PullRequestTitle({
  title,
  number,
  writes,
  onOpen,
}: {
  title: string;
  number: string;
  writes: PullRequestWrites;
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const busy = writes.pending !== undefined;
  const end = ({ value }: InlineEditEnd) => {
    setEditing(false);
    if (value === undefined) return;
    void writes.write({ action: PULL_REQUEST_ACTION.EDIT_TITLE, title: value });
  };
  if (editing) {
    return (
      <PullRequestTitleLine field>
        <InlineEdit
          value={title}
          label={TITLE_WORDS.FIELD}
          editing
          maxLength={PULL_REQUEST_WRITE_BOUNDS.MAX_TITLE_CHARS}
          look={INLINE_EDIT_LOOK.INPUT}
          onEnd={end}
        />
      </PullRequestTitleLine>
    );
  }
  const numberWords = <span className="pull-request-number">{number}</span>;
  return (
    <CommandLink
      as={COMMAND_LINK_ELEMENT.H2}
      className="pull-request-title pull-request-title-editable"
      onOpen={onOpen}
    >
      {title}
      <span className="pull-request-title-end">
        {" "}
        {onOpen === undefined ? (
          numberWords
        ) : (
          <Tooltip label={TITLE_WORDS.OPEN}>{numberWords}</Tooltip>
        )}
        <span className="pull-request-title-edit">
          <Tooltip label={TITLE_WORDS.EDIT}>
            <IconButton
              icon={<GLYPH.RENAME />}
              label={TITLE_WORDS.EDIT}
              size={BUTTON_SIZE.COMPACT}
              disabled={busy}
              onClick={() => setEditing(true)}
            />
          </Tooltip>
        </span>
      </span>
    </CommandLink>
  );
}

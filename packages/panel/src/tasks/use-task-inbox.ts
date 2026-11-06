import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentInboxAnsweredView,
  type AgentInboxAnswerParams,
  type AgentInboxAttachmentParams,
  type AgentInboxAttachmentView,
  type AgentInboxMessagedView,
  type AgentInboxMessageParams,
  type AgentInboxScope,
  type AgentInboxStartParams,
  INBOX_SCOPE_KIND,
} from "@repo/features/agent-view";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { INBOX_REPLY, INBOX_STATUS, type InboxItem } from "@repo/features/inbox-wire";
import type { AppInboxItems } from "@repo/host/app-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Equal } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DRAFT_PLACE,
  type Draft,
  draftOfItem,
  EMPTY_DRAFT,
  holdsPicks,
  type InboxPlace,
  picksStandOn,
  useDraftWriter,
  useInboxDraftStandings,
  useInboxDrafts,
  withoutPicks,
} from "../composer-drafts.js";
import { holderInboxQuery, holderInboxRetryMutation, inboxItemsQuery } from "../live-reads.js";
import type { PictureReader } from "../picture-query.js";
import { useSendQueue } from "../send-queue.js";
import { messageFailureWords } from "./agent-model.js";
import { useInboxArrivals } from "./inbox-arrivals.js";
import {
  awaitsNod,
  EMPTY_INBOX_DRAFT,
  type InboxBoardView,
  type InboxDraft,
  type InboxNote,
  inboxBoard,
  inboxThreadSend,
} from "./inbox-model.js";

export type InboxAnswerer = (params: AgentInboxAnswerParams) => Promise<AgentInboxAnsweredView>;

export type InboxMessenger = (params: AgentInboxMessageParams) => Promise<AgentInboxMessagedView>;

export type InboxThreadStarter = (params: AgentInboxStartParams) => Promise<AgentInboxMessagedView>;

export type InboxImageReader = (
  params: AgentInboxAttachmentParams,
) => Promise<AgentInboxAttachmentView>;

export interface PendingInboxReply {
  readonly key: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly at: number;
}

const NO_REPLIES: readonly PendingInboxReply[] = [];

function holdsSent(item: InboxItem, key: string): boolean {
  return (item.thread ?? []).some((message) => message.clientKey === key);
}

export function pendingRepliesOn(
  pending: TaskInboxControl["pendingReplies"],
  item: InboxItem,
): readonly PendingInboxReply[] {
  const replies = pending.get(item.id);
  if (replies === undefined) return NO_REPLIES;
  return replies.filter((reply) => !holdsSent(item, reply.key));
}

export interface TaskInboxControl {
  readonly board: InboxBoardView;
  readonly reading: boolean;
  readonly read: boolean;
  readonly drawn: boolean;
  readonly failed: boolean;
  readonly onRetry: () => void;
  readonly sending: ReadonlySet<string>;
  readonly pendingReplies: ReadonlyMap<string, readonly PendingInboxReply[]>;
  readonly notes: ReadonlyMap<string, InboxNote>;
  readonly onDropNote: (itemId: string, note: InboxNote) => void;
  readonly draftOf: (item: InboxItem) => InboxDraft;
  readonly drafted: boolean;
  readonly onDraft: (item: InboxItem, draft: InboxDraft) => void;
  readonly onAttachments: (
    item: InboxItem,
    next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[],
  ) => void;
  readonly onAcknowledge: (item: InboxItem) => void;
  readonly onMessage: (item: InboxItem, draft: InboxDraft, taken?: () => void) => void;
  readonly images: InboxImageReads;
}

const INBOX_NOT_TAKEN_NOTE = {
  CHANGED: "The agent changed this item before your answer landed. Answer it as it stands now.",
  ANSWERED: "This item was already answered.",
  CLOSED: "The agent took this item back.",
  CLOSED_BY_MEMBER: "This item was already resolved.",
} as const;

function notTakenNote(item: InboxItem): string {
  switch (item.status) {
    case INBOX_STATUS.ANSWERED:
      return INBOX_NOT_TAKEN_NOTE.ANSWERED;
    case INBOX_STATUS.CLOSED:
      return item.closedBy === undefined
        ? INBOX_NOT_TAKEN_NOTE.CLOSED
        : INBOX_NOT_TAKEN_NOTE.CLOSED_BY_MEMBER;
    case INBOX_STATUS.OPEN:
      return INBOX_NOT_TAKEN_NOTE.CHANGED;
  }
}

interface UnheardReply {
  readonly key: string;
  readonly taskId: string | undefined;
  readonly place: InboxPlace;
  readonly unsent: Draft;
  readonly note: InboxNote;
}

interface Attempt {
  readonly key: string;
  readonly words: string;
}

function keyFor(attempts: Map<string, Attempt>, itemId: string, words: string): string {
  const was = attempts.get(itemId);
  attempts.delete(itemId);
  return was?.words === words ? was.key : crypto.randomUUID();
}

interface QueuedReply {
  readonly params: AgentInboxMessageParams;
  readonly words: string;
  readonly went: Draft;
  readonly shown: PendingInboxReply | undefined;
}

interface Held {
  readonly taskId: string | undefined;
  readonly items: readonly InboxItem[];
  readonly drawn: boolean;
}

function fresh(taskId: string | undefined, read: readonly InboxItem[] | undefined): Held {
  return { taskId, items: read ?? [], drawn: read !== undefined };
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

function fedItemsOf(
  fed: AppInboxItems | undefined,
  kind: AgentInboxScope["kind"],
  id: string | undefined,
  planId: string | null | undefined,
): readonly InboxItem[] | undefined {
  if (fed === undefined || id === undefined) return undefined;
  if (kind === INBOX_SCOPE_KIND.PLAN) return fed[INBOX_SCOPE_KIND.PLAN][id];
  if (planId == null) return fed[INBOX_SCOPE_KIND.AGENT][id];
  return fed[INBOX_SCOPE_KIND.PLAN][planId]?.filter((item) => item.agentId === id);
}

export interface InboxImageReads {
  readonly read: PictureReader;
}

function draftPlace(item: InboxItem, taskId: string | null): InboxPlace {
  return { kind: DRAFT_PLACE.INBOX, planId: taskId, agentId: item.agentId, itemId: item.id };
}

function withItem(items: readonly InboxItem[], item: InboxItem): readonly InboxItem[] {
  return items.some((each) => each.id === item.id)
    ? items.map((each) => (each.id === item.id ? item : each))
    : [item, ...items];
}

function caughtUp(item: InboxItem, draft: Pick<Draft, "revision">): boolean {
  return draft.revision === undefined || item.revision >= draft.revision;
}

function keptDraft(draft: InboxDraft, revision: number): Draft {
  return {
    revision,
    text: draft.note,
    attachments: draft.attachments,
    choices: draft.choices,
    values: draft.values,
    steps: draft.steps,
    press: draft.press,
    resolving: draft.resolving,
  };
}

function holdsAnswer(draft: Draft): boolean {
  return holdsPicks({ ...draft, resolving: undefined });
}

function withRefused(now: Draft, went: Draft): Draft {
  if (holdsNothing(now)) return went;
  const keeps = holdsAnswer(now) || (now.resolving === true && now.revision !== went.revision);
  return {
    ...(keeps ? now : went),
    resolving: now.resolving ?? went.resolving,
    text: [went.text, now.text].filter((words) => words !== "").join("\n"),
    attachments: [...went.attachments, ...now.attachments],
  };
}

function carriedBack(first: Draft, behind: readonly Draft[]): Draft {
  return behind.reduce(
    (joined, went) => ({
      ...(holdsAnswer(went) ? went : joined),
      resolving: went.resolving ?? joined.resolving,
      text: [joined.text, went.text].filter((words) => words !== "").join("\n"),
      attachments: [...joined.attachments, ...went.attachments],
    }),
    first,
  );
}

function holdsOnly(now: Draft, went: Draft): boolean {
  return now.text === went.text && Equal.equals(now.attachments, went.attachments);
}

function holdsNothing(draft: Draft): boolean {
  return (
    draft.text === "" &&
    draft.attachments.length === 0 &&
    draft.choices.length === 0 &&
    draft.values.length === 0 &&
    (draft.steps ?? []).length === 0 &&
    draft.press === undefined &&
    draft.resolving === undefined
  );
}

function draftScope(
  taskId: string | undefined,
  kind: AgentInboxScope["kind"],
  draftTask: string | null | undefined,
) {
  const ownTask = kind === INBOX_SCOPE_KIND.PLAN ? taskId : undefined;
  return {
    ownTask,
    draftsOn: ownTask ?? draftTask ?? null,
    readAgent: kind === INBOX_SCOPE_KIND.AGENT ? taskId : undefined,
  };
}

type InboxCardDrafts = Pick<TaskInboxControl, "draftOf" | "drafted" | "onDraft" | "onAttachments">;

export type HeldTaskInboxControl = Omit<TaskInboxControl, keyof InboxCardDrafts> & {
  readonly whole: readonly InboxItem[] | undefined;
};

export function useTaskInbox(input: Parameters<typeof useHeldTaskInbox>[0]): TaskInboxControl {
  const held = useHeldTaskInbox(input);
  useInboxDraftsLetGo(held, input);
  return { ...held, ...useInboxCardDrafts(held, input) };
}

export function useHeldTaskInbox(input: {
  taskId: string | undefined;
  kind?: AgentInboxScope["kind"] | undefined;
  draftTask?: string | null | undefined;
  shown: boolean;
  onScreen?: boolean | undefined;
  waiting: boolean;
  readerId: string | undefined;
  agents: {
    readonly heldIds: readonly string[] | undefined;
    readonly answerInbox: InboxAnswerer;
    readonly messageInbox: InboxMessenger;
    readonly readInboxImage: InboxImageReader;
    readonly onRetryList: () => void;
  };
}): HeldTaskInboxControl {
  const { taskId, shown, waiting, readerId, agents } = input;
  const kind = input.kind ?? INBOX_SCOPE_KIND.PLAN;

  const readable = (agents.heldIds?.length ?? 0) > 0 || waiting;
  const active = shown && taskId !== undefined && readable;
  const holderKey = active && taskId !== undefined ? { kind, id: taskId } : undefined;
  const holder = useQuery(holderInboxQuery(holderKey));
  const { mutate: retryHolder } = useMutation(holderInboxRetryMutation());
  const holderId = holderKey?.id;
  const onRetry = useCallback(() => {
    if (holderId !== undefined) retryHolder({ kind, id: holderId });
  }, [retryHolder, kind, holderId]);
  const feed = useQuery(inboxItemsQuery());
  const planItems =
    kind === INBOX_SCOPE_KIND.AGENT && input.draftTask != null
      ? feed.data?.[INBOX_SCOPE_KIND.PLAN][input.draftTask]
      : undefined;
  const fedRows = feed.data;
  const fed = useMemo(
    () =>
      planItems === undefined
        ? fedItemsOf(fedRows, kind, taskId, input.draftTask)
        : planItems.filter((item) => item.agentId === taskId),
    [fedRows, planItems, kind, taskId, input.draftTask],
  );
  const pushed = holder.data ?? fed;
  const read = holder.isSuccess;
  const failed = holder.isError;
  const [held, setHeld] = useState<Held>(() => fresh(taskId, pushed));
  if (held.taskId !== taskId) setHeld(fresh(taskId, pushed));
  useInboxArrivals(
    { taskId: held.taskId, items: held.items, read: held.drawn },
    input.onScreen === true,
  );
  const readInboxImage = input.agents.readInboxImage;
  const images = useMemo<InboxImageReads>(
    () => ({
      read: (itemId, attachmentId) => readInboxImage({ itemId, attachmentId }),
    }),
    [readInboxImage],
  );
  const [sending, setSending] = useState<ReadonlySet<string>>(new Set());
  const [pendingReplies, setPendingReplies] = useState<
    ReadonlyMap<string, readonly PendingInboxReply[]>
  >(new Map());
  const [notes, setNotes] = useState<ReadonlyMap<string, InboxNote>>(new Map());
  const [unheard, setUnheard] = useState<ReadonlyMap<string, UnheardReply>>(new Map());
  const draftsOn = draftScope(taskId, kind, input.draftTask).draftsOn;
  const writer = useDraftWriter();
  const attempts = useRef(new Map<string, Attempt>());
  const out = useRef(new Set<string>());
  const queue = useSendQueue();
  const queued = useRef(new Map<string, readonly QueuedReply[]>());
  const answered = useRef(new Map<string, InboxItem>());
  const latest = useRef({ ...agents, taskId });
  latest.current = { ...agents, taskId };

  useEffect(() => {
    if (pushed === undefined) {
      setHeld((was) => (was.drawn ? fresh(was.taskId, undefined) : was));
      return;
    }
    setHeld((was) =>
      was.drawn && was.items === pushed ? was : { ...was, items: pushed, drawn: true },
    );
  }, [pushed]);

  const note = useCallback((itemId: string, said: InboxNote | undefined) => {
    setNotes((was) => {
      const next = new Map(was);
      if (said === undefined) next.delete(itemId);
      else next.set(itemId, said);
      return next;
    });
  }, []);
  const onDropNote = useCallback((itemId: string, said: InboxNote) => {
    setNotes((was) => {
      if (was.get(itemId) !== said) return was;
      const next = new Map(was);
      next.delete(itemId);
      return next;
    });
  }, []);

  const refused = useCallback(
    (itemId: string, failure: AgentCallFailure): InboxNote => {
      const said = { words: messageFailureWords(failure), failure };
      note(itemId, said);
      if (failure === AGENT_CALL_FAILURE.NOT_FOUND) latest.current.onRetryList();
      return said;
    },
    [note],
  );

  const requeue = useCallback(
    (itemId: string, change: (was: readonly QueuedReply[]) => readonly QueuedReply[]) => {
      const next = change(queued.current.get(itemId) ?? []);
      if (next.length === 0) queued.current.delete(itemId);
      else queued.current.set(itemId, next);
      const shown = next.flatMap((reply) => (reply.shown === undefined ? [] : [reply.shown]));
      setPendingReplies((standing) => {
        if (shown.length === 0 && !standing.has(itemId)) return standing;
        const drawn = new Map(standing);
        if (shown.length === 0) drawn.delete(itemId);
        else drawn.set(itemId, shown);
        return drawn;
      });
    },
    [],
  );

  useEffect(() => {
    const landed = [...unheard.values()].filter((reply) => {
      const item = held.items.find((each) => each.id === reply.place.itemId);
      return held.taskId === reply.taskId && item !== undefined && holdsSent(item, reply.key);
    });
    if (landed.length === 0) return;
    setUnheard((standing) => {
      const next = new Map(standing);
      for (const reply of landed) {
        if (next.get(reply.place.itemId) === reply) next.delete(reply.place.itemId);
      }
      return next;
    });
    for (const reply of landed) {
      const { itemId } = reply.place;
      onDropNote(itemId, reply.note);
      writer.update(reply.place, (now) =>
        holdsOnly(now, reply.unsent) ? { ...now, text: "", attachments: [] } : now,
      );
      if (attempts.current.get(itemId)?.key === reply.key) attempts.current.delete(itemId);
    }
    latest.current.onRetryList();
  }, [held, unheard, onDropNote, writer]);

  const onAcknowledge = useCallback(
    (item: InboxItem) => {
      if (out.current.has(item.id)) return;
      out.current.add(item.id);
      const words = JSON.stringify([item.revision, INBOX_REPLY.ACKNOWLEDGED]);
      const key = keyFor(attempts.current, item.id, words);
      setSending((standing) => new Set(standing).add(item.id));
      note(item.id, undefined);
      const release = () => {
        out.current.delete(item.id);
        setSending((standing) => {
          const next = new Set(standing);
          next.delete(item.id);
          return next;
        });
      };
      queue.after(item.id, async () => {
        const settled = answered.current.get(item.id);
        if (settled !== undefined && settled.revision === item.revision && !awaitsNod(settled)) {
          release();
          return;
        }
        const answer = await latest.current
          .answerInbox({
            itemId: item.id,
            revision: item.revision,
            reply: INBOX_REPLY.ACKNOWLEDGED,
            clientKey: key,
          })
          .catch((): AgentInboxAnsweredView => UNANSWERED);
        release();
        if ("failure" in answer) {
          attempts.current.set(item.id, { key, words });
          refused(item.id, answer.failure);
          return;
        }
        if (!answer.taken) {
          note(item.id, { words: notTakenNote(answer.item) });
          return;
        }
        if (item.needsReply) latest.current.onRetryList();
      });
    },
    [note, refused, queue],
  );

  const onMessage = useCallback(
    (item: InboxItem, draft: InboxDraft, taken?: () => void) => {
      const message = inboxThreadSend(item.thread ?? [], draft);
      if (message === undefined || out.current.has(item.id)) return;
      const { text, attachments, answers } = message;
      const revision = awaitsNod(item) ? item.revision : undefined;
      const words = JSON.stringify([text, attachments, answers, revision]);
      const key = keyFor(attempts.current, item.id, words);
      note(item.id, undefined);
      setUnheard((standing) => {
        if (!standing.has(item.id)) return standing;
        const next = new Map(standing);
        next.delete(item.id);
        return next;
      });
      const place = draftPlace(item, draftsOn);
      const went = keptDraft(draft, item.revision);
      writer.update(place, () => EMPTY_DRAFT);
      const reply: QueuedReply = {
        params: {
          itemId: item.id,
          text,
          ...(attachments.length === 0 ? undefined : { attachments }),
          ...(answers === undefined ? undefined : { answers }),
          ...(revision === undefined ? undefined : { revision }),
          clientKey: key,
        },
        words,
        went,
        shown: answers === undefined ? { key, text, attachments, at: Date.now() } : undefined,
      };
      requeue(item.id, (was) => [...was, reply]);
      const askedOn = taskId;
      const ours = (each: QueuedReply) => each.params.clientKey === key;
      queue.after(item.id, async () => {
        if (!(queued.current.get(item.id) ?? []).some(ours)) return;
        const answer = await latest.current
          .messageInbox(reply.params)
          .catch((): AgentInboxMessagedView => UNANSWERED);
        if ("failure" in answer) {
          const standing = queued.current.get(item.id) ?? [];
          const behind = standing.slice(standing.findIndex(ours) + 1);
          requeue(item.id, (was) => was.filter((each) => !ours(each) && !behind.includes(each)));
          writer.update(place, (now) =>
            withRefused(
              now,
              carriedBack(
                went,
                behind.map((each) => each.went),
              ),
            ),
          );
          attempts.current.set(item.id, { key, words });
          const said = refused(item.id, answer.failure);
          if (answer.failure === AGENT_CALL_FAILURE.UNANSWERED) {
            const kept: UnheardReply = { key, taskId: askedOn, place, unsent: went, note: said };
            setUnheard((standing) => new Map(standing).set(item.id, kept));
          }
          return;
        }
        requeue(item.id, (was) => was.filter((each) => !ours(each)));
        answered.current.set(item.id, answer.item);
        setHeld((standing) =>
          standing.taskId === askedOn
            ? { ...standing, items: withItem(standing.items, answer.item) }
            : standing,
        );
        latest.current.onRetryList();
        taken?.();
      });
    },
    [note, refused, taskId, writer, draftsOn, queue, requeue],
  );

  const asked = useRef(new Set<string>());
  const ids = agents.heldIds;
  useEffect(() => {
    if (ids === undefined) return;
    const unknown = held.items
      .map((item) => item.agentId)
      .filter((agentId) => !ids.includes(agentId) && !asked.current.has(agentId));
    if (unknown.length === 0) return;
    for (const agentId of unknown) asked.current.add(agentId);
    latest.current.onRetryList();
  }, [held.items, ids]);

  const board = useMemo(() => inboxBoard(held.items, readerId), [held.items, readerId]);

  return {
    board,
    reading: active && !held.drawn && !failed,
    read,
    drawn: held.drawn,
    failed,
    onRetry,
    whole: holder.data,
    sending,
    pendingReplies,
    notes,
    onDropNote,
    onAcknowledge,
    onMessage,
    images,
  };
}

interface DraftScopeOf {
  readonly taskId: string | undefined;
  readonly kind?: AgentInboxScope["kind"] | undefined;
  readonly draftTask?: string | null | undefined;
}

export function useInboxDraftsLetGo(
  control: Pick<HeldTaskInboxControl, "board" | "drawn" | "whole">,
  scope: DraftScopeOf,
): void {
  const { ownTask, draftsOn, readAgent } = draftScope(
    scope.taskId,
    scope.kind ?? INBOX_SCOPE_KIND.PLAN,
    scope.draftTask,
  );
  const standings = useInboxDraftStandings();
  const { drop, update } = useDraftWriter();
  const { board, drawn, whole } = control;
  const items = useMemo(() => [...board.open, ...board.settled], [board]);
  useEffect(() => {
    if (!drawn || (ownTask === undefined && readAgent === undefined)) return;
    const covered = standings.filter(
      ({ place }) =>
        place.planId === draftsOn && (ownTask !== undefined || place.agentId === readAgent),
    );
    const gone =
      whole === undefined
        ? []
        : covered.filter((kept) => !whole.some((item) => item.id === kept.place.itemId));
    const lapsed = covered.filter((kept) => {
      const item = items.find((each) => each.id === kept.place.itemId);
      return (
        item !== undefined && caughtUp(item, kept) && !picksStandOn(kept.revision, kept.picks, item)
      );
    });
    for (const kept of lapsed) update(kept.place, withoutPicks);
    if (gone.length > 0) drop((place) => gone.some((kept) => Equal.equals(kept.place, place)));
  }, [drawn, items, whole, ownTask, readAgent, draftsOn, standings, drop, update]);
}

export function useInboxCardDrafts(
  control: Pick<HeldTaskInboxControl, "board">,
  scope: DraftScopeOf,
): InboxCardDrafts {
  const { draftsOn } = draftScope(
    scope.taskId,
    scope.kind ?? INBOX_SCOPE_KIND.PLAN,
    scope.draftTask,
  );
  const drafts = useInboxDrafts(draftsOn);
  const writer = useDraftWriter();
  const { board } = control;
  const items = useMemo(() => [...board.open, ...board.settled], [board]);

  const draftOf = useCallback(
    (item: InboxItem): InboxDraft => {
      const found = drafts.find((each) => each.place.itemId === item.id);
      const kept = found === undefined ? undefined : draftOfItem(found, item);
      return kept === undefined
        ? EMPTY_INBOX_DRAFT
        : {
            choices: kept.choices,
            values: kept.values,
            note: kept.text,
            attachments: kept.attachments,
            steps: kept.steps,
            press: kept.press,
            resolving: kept.resolving,
          };
    },
    [drafts],
  );
  const drafted = drafts.some((kept) =>
    items.some((item) => item.id === kept.place.itemId && !holdsNothing(draftOfItem(kept, item))),
  );
  const onDraft = useCallback(
    (item: InboxItem, draft: InboxDraft) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        revision: item.revision,
        text: draft.note,
        choices: draft.choices,
        values: draft.values,
        attachments: draft.attachments,
        steps: draft.steps,
        press: draft.press,
        resolving: draft.resolving,
      })),
    [writer, draftsOn],
  );

  const onAttachments = useCallback(
    (item: InboxItem, next: (was: readonly AgentAttachment[]) => readonly AgentAttachment[]) =>
      writer.update(draftPlace(item, draftsOn), (was) => ({
        ...was,
        attachments: next(was.attachments),
      })),
    [writer, draftsOn],
  );

  return { draftOf, drafted, onDraft, onAttachments };
}

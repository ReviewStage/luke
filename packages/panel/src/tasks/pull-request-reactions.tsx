import type { GitHubPerson, ReactionGroup } from "@repo/features/agent-wire";
import { formatCount } from "@repo/features/number-format";
import {
  PULL_REQUEST_ACTION,
  REACTION,
  type Reaction,
} from "@repo/features/pull-request-write-wire";
import { andList } from "@repo/features/words";
import {
  AnchoredPopover,
  Badge,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  GAP,
  IconButton,
  Inline,
  LAYOUT_ELEMENT,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
  PopoverPanel,
  Tooltip,
} from "@repo/ui";
import { ACTOR_KIND, actorName, githubActor } from "@repo/ui/actor-model";
import { SmilePlusIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useMemberDirectory } from "../member-directory.js";
import { noop, useThreadWriting } from "./pull-request-thread-actions.js";
import { PullRequestWriteNote, usePullRequestWrites } from "./pull-request-writes.js";

const REACTION_FACES = {
  [REACTION.THUMBS_UP]: { emoji: "👍", name: "thumbs up", item: "Thumbs up" },
  [REACTION.THUMBS_DOWN]: { emoji: "👎", name: "thumbs down", item: "Thumbs down" },
  [REACTION.LAUGH]: { emoji: "😄", name: "laugh", item: "Laugh" },
  [REACTION.HOORAY]: { emoji: "🎉", name: "hooray", item: "Hooray" },
  [REACTION.CONFUSED]: { emoji: "😕", name: "confused", item: "Confused" },
  [REACTION.HEART]: { emoji: "❤️", name: "heart", item: "Heart" },
  [REACTION.ROCKET]: { emoji: "🚀", name: "rocket", item: "Rocket" },
  [REACTION.EYES]: { emoji: "👀", name: "eyes", item: "Eyes" },
} as const satisfies Record<
  Reaction,
  { readonly emoji: string; readonly name: string; readonly item: string }
>;

const REACTION_ORDER: readonly Reaction[] = Object.values(REACTION);

const ADD_REACTION = "Add reaction";

function reactedWords(names: readonly string[], count: number, name: string): string {
  const others = count - names.length;
  if (names.length === 0) return `${count} reacted with ${name}`;
  const who = others > 0 ? [...names, `${others} more`] : names;
  return `${andList(who)} reacted with ${name}`;
}

function drawnReactions(
  reactions: readonly ReactionGroup[],
  given: Reaction | undefined,
): readonly ReactionGroup[] {
  if (given === undefined || reactions.some((reaction) => reaction.content === given)) {
    return reactions;
  }
  return [...reactions, { content: given, count: 1, mine: true }].sort(
    (a, b) => REACTION_ORDER.indexOf(a.content) - REACTION_ORDER.indexOf(b.content),
  );
}

interface Settled {
  readonly on: readonly ReactionGroup[] | undefined;
  readonly content: Reaction;
  readonly mine: boolean;
}

function settledReactions(
  reactions: readonly ReactionGroup[] | undefined,
  settled: Settled | undefined,
  { isMine, isYou }: Reader,
): readonly ReactionGroup[] {
  const read = reactions ?? [];
  if (settled === undefined || settled.on !== reactions) return read;
  const held = read.find((reaction) => reaction.content === settled.content);
  if ((held !== undefined && isMine(held)) === settled.mine) return read;
  const count = (held?.count ?? 0) + (settled.mine ? 1 : -1);
  const rest = read.filter((reaction) => reaction.content !== settled.content);
  if (count <= 0) return rest;
  const by = settled.mine ? held?.by : held?.by?.filter((person) => !isYou(person));
  const group = { content: settled.content, count, mine: settled.mine };
  return [...rest, by === undefined ? group : { ...group, by }].sort(
    (a, b) => REACTION_ORDER.indexOf(a.content) - REACTION_ORDER.indexOf(b.content),
  );
}

interface Reader {
  readonly isMine: (reaction: ReactionGroup) => boolean;
  readonly isYou: (person: GitHubPerson) => boolean;
}

function useReader(): Reader {
  const { members, readerId, former } = useMemberDirectory();
  const isYou = (person: GitHubPerson) => {
    const actor = githubActor(person, { members, readerId, former });
    return actor.kind === ACTOR_KIND.PERSON && actor.you;
  };
  return { isYou, isMine: (reaction) => reaction.mine ?? (reaction.by ?? []).some(isYou) };
}

interface PillPress {
  readonly onPress: () => void;
  readonly busy: boolean;
  readonly waiting: boolean;
}

function ReactionPill({
  reaction,
  mine,
  press,
}: {
  reaction: ReactionGroup;
  mine: boolean;
  press: PillPress | undefined;
}): React.JSX.Element {
  const { members, readerId, former } = useMemberDirectory();
  const face = REACTION_FACES[reaction.content];
  const names = (reaction.by ?? []).map((person, at) =>
    actorName(githubActor(person, { members, readerId, former }), { sentence: at > 0 }),
  );
  const words = reactedWords(names, reaction.count, face.name);
  const inner = (
    <>
      <span aria-hidden="true">{face.emoji}</span>
      <span className="tabular-nums" aria-hidden="true">
        {formatCount(reaction.count)}
      </span>
    </>
  );
  return (
    <li>
      <Tooltip label={words}>
        {press === undefined ? (
          <span className="flex" role="img" aria-label={words}>
            <Badge lit={mine}>{inner}</Badge>
          </span>
        ) : (
          <Chip
            look={CHIP_LOOK.FILTER}
            size={CHIP_SIZE.COMPACT}
            aria-label={words}
            aria-pressed={mine}
            busy={press.busy}
            disabled={press.waiting}
            onClick={press.onPress}
          >
            {inner}
          </Chip>
        )}
      </Tooltip>
    </li>
  );
}

const PICKER_WIDTH = 296;

const PICKER_STEP = new Map([
  ["ArrowRight", 1],
  ["ArrowLeft", -1],
]);

function AddReaction({
  mine,
  waiting,
  onPick,
}: {
  mine: ReadonlySet<Reaction>;
  waiting: boolean;
  onPick: (content: Reaction) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const panelId = useId();
  const root = useRef<HTMLLIElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const move = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = PICKER_STEP.get(event.key);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? REACTION_ORDER.length - 1
          : step === undefined
            ? undefined
            : (at + step + REACTION_ORDER.length) % REACTION_ORDER.length;
    if (next === undefined) return;
    event.preventDefault();
    setAt(next);
    root.current
      ?.querySelectorAll<HTMLButtonElement>(".pull-request-reaction-choices button")
      [next]?.focus();
  };
  return (
    <li className="relative" ref={root}>
      <Tooltip label={ADD_REACTION}>
        <IconButton
          ref={trigger}
          icon={<SmilePlusIcon aria-hidden="true" />}
          label={ADD_REACTION}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          disabled={waiting}
          onClick={() => {
            setAt(0);
            setOpen(!open);
          }}
        />
      </Tooltip>
      <AnchoredPopover open={open} align={POPOVER_ALIGN.START} width={PICKER_WIDTH}>
        <PopoverPanel
          open={open}
          id={panelId}
          title={ADD_REACTION}
          look={POPOVER_PANEL_LOOK.MENU}
          initialFocus={first}
          onDismiss={close}
          onLeave={(left) => {
            if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
          }}
        >
          <div
            className="pull-request-reaction-choices flex flex-wrap gap-list-gap p-tight-gap"
            role="toolbar"
            aria-label={ADD_REACTION}
            onKeyDown={move}
          >
            {REACTION_ORDER.map((content, index) => (
              <Tooltip key={content} label={REACTION_FACES[content].item}>
                <IconButton
                  ref={index === 0 ? first : undefined}
                  icon={
                    <span className="text-dialog leading-none" aria-hidden="true">
                      {REACTION_FACES[content].emoji}
                    </span>
                  }
                  label={REACTION_FACES[content].item}
                  pressed={mine.has(content)}
                  tabbable={index === at}
                  onClick={() => {
                    onPick(content);
                    close();
                  }}
                />
              </Tooltip>
            ))}
          </div>
        </PopoverPanel>
      </AnchoredPopover>
    </li>
  );
}

export function Reactions({
  reactions,
  subject,
}: {
  reactions: readonly ReactionGroup[] | undefined;
  subject?: string | undefined;
}): React.JSX.Element | null {
  const reader = useReader();
  const { isMine } = reader;
  const writing = useThreadWriting();
  const readAgain = writing?.onWritten ?? noop;
  const writes = usePullRequestWrites(writing?.agentId ?? "", () => void readAgain());
  const [pressed, setPressed] = useState<Reaction | undefined>(undefined);
  const [settled, setSettled] = useState<Settled | undefined>(undefined);
  const waiting = writes.pending !== undefined;
  const busyOn = waiting ? pressed : undefined;
  const drawn = drawnReactions(settledReactions(reactions, settled, reader), busyOn);
  const pressable = writing !== undefined && subject !== undefined;
  if (drawn.length === 0 && !pressable) return null;
  const mine = new Set(drawn.flatMap((reaction) => (isMine(reaction) ? [reaction.content] : [])));
  const send = (content: Reaction) => {
    if (subject === undefined || waiting) return;
    const given = !mine.has(content);
    setPressed(content);
    writes.write(
      {
        action: given ? PULL_REQUEST_ACTION.ADD_REACTION : PULL_REQUEST_ACTION.REMOVE_REACTION,
        subject,
        content,
      },
      () => setSettled({ on: reactions, content, mine: given }),
    );
  };
  return (
    <>
      <Inline
        as={LAYOUT_ELEMENT.UL}
        gap={GAP.TIGHT}
        className="pull-request-reactions"
        aria-label="Reactions"
      >
        {drawn.map((reaction) => (
          <ReactionPill
            key={reaction.content}
            reaction={reaction}
            mine={mine.has(reaction.content)}
            press={
              pressable
                ? {
                    onPress: () => send(reaction.content),
                    busy: busyOn === reaction.content,
                    waiting,
                  }
                : undefined
            }
          />
        ))}
        {pressable ? <AddReaction mine={mine} waiting={waiting} onPick={send} /> : null}
      </Inline>
      <PullRequestWriteNote writes={writes} className="pull-request-reaction-note" />
    </>
  );
}

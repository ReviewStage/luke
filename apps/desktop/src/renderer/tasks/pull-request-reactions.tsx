/**
 * pull-request-reactions.tsx -- the reactions a pull request's description, comment, review, or thread comment wears, drawn under it as GitHub draws them, each pressed to give it or take it back.
 *
 * Each reaction given is a pill of its emoji and how many gave it, in
 * GitHub's order, its tooltip naming who did as the conversation names
 * people, the reader as "You". The reader's own is lit, as GitHub lights
 * the viewer's: as the service read it on the reader's own GitHub sign-in
 * (`mine`), or, where it could not, where the read named the reader among
 * those who gave it, since the overview's own read runs on the App's token
 * and GitHub's word for the viewer there speaks for the App's bot.
 *
 * Where what wears them names the id a reaction is given by (`subject`), a
 * pill is a press that takes the reader's own back where it is lit and
 * gives it where it is not, and Add reaction at the row's end opens a
 * compact row of GitHub's eight. Each press is a change (`ADD_REACTION`,
 * `REMOVE_REACTION`) the row sends itself, as a review thread's controls do
 * (`pull-request-thread-actions.tsx`), on the agent the tab names: made on
 * GitHub by the service as the member pressing it, on their own GitHub
 * sign-in and never the Luke GitHub App's. While it is out, the reaction
 * it is on says so, one being given that nobody had given yet standing as
 * a pill of its own, and the row's other presses wait; the state pill
 * says nothing of it. Once GitHub answers the tab reads the conversation
 * again, and where GitHub would not take it, why stands under the row.
 */

import type { GitHubPerson, ReactionGroup } from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  REACTION,
  type Reaction,
} from "@luke/features/pull-request-write-wire";
import { useMemberDirectory } from "@luke/panel/member-directory";
import { PopoverPanel } from "@luke/panel/popover-panel";
import { Tooltip } from "@luke/panel/tooltip";
import {
  AnchoredPopover,
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  IconButton,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
} from "@luke/ui";
import { ACTOR_KIND, actorName, githubActor } from "@luke/ui/actor-model";
import { SmilePlusIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { noop, useThreadWriting } from "./pull-request-thread-actions";
import { PullRequestWriteNote, usePullRequestWrites } from "./pull-request-writes";

/** Each reaction's emoji, its name as GitHub says it, and its name on Add reaction's menu. */
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

/** GitHub's order, which the row keeps. */
const REACTION_ORDER: readonly Reaction[] = Object.values(REACTION);

const ADD_REACTION = "Add reaction";

/** Names in a sentence: "a", "a and b", "a, b, and c". */
function listed(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

/** What a reaction's tooltip says: who gave it, as many as the read named, the rest counted. */
function reactedWords(names: readonly string[], count: number, name: string): string {
  const others = count - names.length;
  if (names.length === 0) return `${count} reacted with ${name}`;
  const who = others > 0 ? [...names, `${others} more`] : names;
  return `${listed(who)} reacted with ${name}`;
}

/** The reactions as the row draws them: one being given that nobody had given yet stands as a pill of its own, the reader's. */
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

/** A change GitHub made, held over the read it was made on until a fresh read replaces it. */
interface Settled {
  /** The reactions as read when the change was pressed. */
  readonly on: readonly ReactionGroup[] | undefined;
  readonly content: Reaction;
  /** Whether the reaction is the reader's now. */
  readonly mine: boolean;
}

/**
 * The reactions as the last change GitHub made left them, while the read
 * they were pressed on still stands: the reaction given counted and lit,
 * or taken back uncounted, gone where nobody else gave it. Note that a
 * press in that gap reads what is lit here, so a second press takes back
 * what the first gave rather than giving it again; a fresh read, or a
 * failed one that leaves the old standing, is drawn as it reads.
 */
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
  // Note that who else gave it is kept for its tooltip, the reader left out where they took theirs back.
  const by = settled.mine ? held?.by : held?.by?.filter((person) => !isYou(person));
  const group = { content: settled.content, count, mine: settled.mine };
  return [...rest, by === undefined ? group : { ...group, by }].sort(
    (a, b) => REACTION_ORDER.indexOf(a.content) - REACTION_ORDER.indexOf(b.content),
  );
}

/** The reader as the row reads them: whether they gave a reaction, as their own sign-in read it, else where the read named them among who did; and whether someone named is them. */
interface Reader {
  /** Whether the reader gave a reaction. */
  readonly isMine: (reaction: ReactionGroup) => boolean;
  /** Whether someone a reaction names is the reader. */
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

/** How a pill is pressed: what a press does, whether its own change is out, and whether any is. */
interface PillPress {
  readonly onPress: () => void;
  readonly busy: boolean;
  readonly waiting: boolean;
}

/** One reaction: its emoji and count in a pill, lit where the reader gave it, its tooltip naming who did; a press where it may be changed. */
function ReactionPill({
  reaction,
  mine,
  press,
}: {
  reaction: ReactionGroup;
  mine: boolean;
  /** None where it may not be pressed. */
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
      <span className="pull-request-reaction-count" aria-hidden="true">
        {reaction.count.toLocaleString()}
      </span>
    </>
  );
  return (
    <li>
      <Tooltip label={words}>
        {press === undefined ? (
          <span className="pull-request-reaction" data-mine={mine} role="img" aria-label={words}>
            {inner}
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

/** How wide the row of eight stands: eight emoji buttons and the panel's inset. */
const PICKER_WIDTH = 296;

/** The keys that move the focus along the picker's row, by how far. */
const PICKER_STEP = new Map([
  ["ArrowRight", 1],
  ["ArrowLeft", -1],
]);

/**
 * Add reaction at the row's end: a press opens one compact row of GitHub's
 * eight, as GitHub and stage-cli draw it, each emoji a button named by its
 * reaction and pressed where it is the reader's own; the arrows move along
 * the row, Home and End to its ends, and a pick gives it, or takes it back
 * where it is the reader's, and closes the row.
 */
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
  // Note that focus goes back to the button, as a menu returns it, because closing takes the focused row away.
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
    <li className="pull-request-reaction-picker" ref={root}>
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
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.START} width={PICKER_WIDTH}>
          <PopoverPanel
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
              className="pull-request-reaction-choices"
              role="toolbar"
              aria-label={ADD_REACTION}
              onKeyDown={move}
            >
              {REACTION_ORDER.map((content, index) => (
                <Tooltip key={content} label={REACTION_FACES[content].item}>
                  <IconButton
                    ref={index === 0 ? first : undefined}
                    icon={
                      <span className="pull-request-reaction-emoji" aria-hidden="true">
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
      ) : null}
    </li>
  );
}

/**
 * The reactions something wears, under its words, each a press where it
 * names what reactions are given by and it is drawn in a tab that may
 * change its pull request; nothing where it wears none and may not be
 * given one.
 */
export function Reactions({
  reactions,
  subject,
}: {
  reactions: readonly ReactionGroup[] | undefined;
  /** The GraphQL id a reaction is given to it by; none where the read named none. */
  subject?: string | undefined;
}): React.JSX.Element | null {
  const reader = useReader();
  const { isMine } = reader;
  const writing = useThreadWriting();
  const writes = usePullRequestWrites(writing?.agentId ?? "", writing?.onWritten ?? noop);
  // Note that the row's change is its own, so which reaction it is on is held here beside it.
  const [pressed, setPressed] = useState<Reaction | undefined>(undefined);
  const [settled, setSettled] = useState<Settled | undefined>(undefined);
  const waiting = writes.pending !== undefined;
  const busyOn = waiting ? pressed : undefined;
  const drawn = drawnReactions(settledReactions(reactions, settled, reader), busyOn);
  const pressable = writing !== undefined && subject !== undefined;
  if (drawn.length === 0 && !pressable) return null;
  const mine = new Set(drawn.flatMap((reaction) => (isMine(reaction) ? [reaction.content] : [])));
  // Note that a press takes the reader's own back and gives any other, so it follows what is lit.
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
      <ul className="pull-request-reactions" aria-label="Reactions">
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
      </ul>
      <PullRequestWriteNote writes={writes} className="pull-request-reaction-note" />
    </>
  );
}

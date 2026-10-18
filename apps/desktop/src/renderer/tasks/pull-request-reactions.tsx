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
 * gives it where it is not, and Add reaction at the row's end offers
 * GitHub's eight. Each press is a change the tab sends through its one
 * writes door (`pull-request-writes.tsx`), on the member's own GitHub
 * sign-in; while it is out, the reaction it is on says so, one being given
 * that nobody had given yet standing as a pill of its own, every press
 * waits, and once GitHub answers the tab reads the conversation again.
 * Where GitHub would not take it, the line under the bar says why.
 */

import { REACTION, type Reaction, type ReactionGroup } from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_ACTION,
  type PullRequestActionRequest,
} from "@luke/features/pull-request-write-wire";
import { ACTOR_KIND, actorName, githubActor } from "@luke/ui/actor-model";
import { SmilePlusIcon } from "lucide-react";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { useMemberDirectory } from "../member-directory";
import { Tooltip } from "../tooltip";
import type { PullRequestWrites } from "./pull-request-writes";

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

/** The reaction a change out now is on, where it is a reaction on this subject. */
function pendingOn(
  pending: PullRequestActionRequest | undefined,
  subject: string | undefined,
): Reaction | undefined {
  if (pending === undefined || !("subject" in pending) || pending.subject !== subject) {
    return undefined;
  }
  return pending.content;
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

/** Whether the reader gave a reaction: as their own sign-in read it, else where the read named them among who did. */
function useMine(): (reaction: ReactionGroup) => boolean {
  const { members, readerId, former } = useMemberDirectory();
  return (reaction) =>
    reaction.mine ??
    (reaction.by ?? []).some((person) => {
      const actor = githubActor(person, { members, readerId, former });
      return actor.kind === ACTOR_KIND.PERSON && actor.you;
    });
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
          <button
            type="button"
            className="pull-request-reaction"
            data-mine={mine}
            aria-label={words}
            aria-pressed={mine}
            aria-busy={press.busy}
            disabled={press.waiting}
            onClick={press.onPress}
          >
            {inner}
          </button>
        )}
      </Tooltip>
    </li>
  );
}

/** Add reaction at the row's end: GitHub's eight, each giving it, or taking it back where it is the reader's own. */
function AddReaction({
  mine,
  waiting,
  onPick,
}: {
  mine: ReadonlySet<Reaction>;
  waiting: boolean;
  onPick: (content: Reaction) => void;
}): React.JSX.Element {
  const menu = useActionMenu(true);
  const items: MenuAction[] = REACTION_ORDER.map((content) => ({
    label: REACTION_FACES[content].item,
    icon: <span aria-hidden="true">{REACTION_FACES[content].emoji}</span>,
    checked: mine.has(content),
    disabled: waiting,
    onSelect: () => onPick(content),
  }));
  return (
    <li>
      <Tooltip label={ADD_REACTION}>
        <button
          type="button"
          className="pull-request-reaction pull-request-reaction-add"
          aria-label={ADD_REACTION}
          disabled={waiting}
          {...menu.trigger()}
        >
          <SmilePlusIcon aria-hidden="true" />
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={ADD_REACTION} menu={menu.drawn} groups={[items]} onClose={menu.close} />
      )}
    </li>
  );
}

/**
 * The reactions something wears, under its words, each a press where it
 * names what reactions are given by and the tab may send a change; nothing
 * where it wears none and may not be given one.
 */
export function Reactions({
  reactions,
  subject,
  writes,
}: {
  reactions: readonly ReactionGroup[] | undefined;
  /** The GraphQL id a reaction is given to it by; none where the read named none. */
  subject?: string | undefined;
  /** The tab's writes door; none where nothing here may be pressed. */
  writes?: PullRequestWrites | undefined;
}): React.JSX.Element | null {
  const isMine = useMine();
  const busyOn = pendingOn(writes?.pending, subject);
  const drawn = drawnReactions(reactions ?? [], busyOn);
  const press = subject === undefined || writes === undefined ? undefined : { subject, writes };
  if (drawn.length === 0 && press === undefined) return null;
  const mine = new Set(drawn.flatMap((reaction) => (isMine(reaction) ? [reaction.content] : [])));
  const waiting = writes?.pending !== undefined;
  // Note that a press takes the reader's own back and gives any other, so it follows what is lit.
  const send = (content: Reaction) =>
    press?.writes.write({
      action: mine.has(content)
        ? PULL_REQUEST_ACTION.REMOVE_REACTION
        : PULL_REQUEST_ACTION.ADD_REACTION,
      subject: press.subject,
      content,
    });
  return (
    <ul className="pull-request-reactions" aria-label="Reactions">
      {drawn.map((reaction) => (
        <ReactionPill
          key={reaction.content}
          reaction={reaction}
          mine={mine.has(reaction.content)}
          press={
            press === undefined
              ? undefined
              : {
                  onPress: () => send(reaction.content),
                  busy: busyOn === reaction.content,
                  waiting,
                }
          }
        />
      ))}
      {press === undefined ? null : <AddReaction mine={mine} waiting={waiting} onPick={send} />}
    </ul>
  );
}

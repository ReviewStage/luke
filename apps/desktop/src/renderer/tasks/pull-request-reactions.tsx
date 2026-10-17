/**
 * pull-request-reactions.tsx -- the reactions a pull request's description, comment, review, or thread comment wears, drawn under it as GitHub draws them.
 *
 * Each reaction given is a pill of its emoji and how many gave it, in
 * GitHub's order, its tooltip naming who did as the conversation names
 * people, the reader as "You". The reader's own is lit, as GitHub lights
 * the viewer's, but only where the read named them among those who gave
 * it: the overview reads on the App's token, so GitHub's own word for
 * whether the viewer reacted speaks for the App's bot rather than the
 * reader, and a reaction the read only counted (a thread comment's, or one
 * past the bound on who is named) is never lit. Nothing here writes a
 * reaction.
 */

import { REACTION, type Reaction, type ReactionGroup } from "@luke/features/coding-agent-wire";
import { ACTOR_KIND, actorName, githubActor } from "@luke/ui/actor-model";
import { useMemberDirectory } from "../member-directory";
import { Tooltip } from "../tooltip";

/** Each reaction's emoji, and its name as GitHub says it. */
const REACTION_FACES = {
  [REACTION.THUMBS_UP]: { emoji: "👍", name: "thumbs up" },
  [REACTION.THUMBS_DOWN]: { emoji: "👎", name: "thumbs down" },
  [REACTION.LAUGH]: { emoji: "😄", name: "laugh" },
  [REACTION.HOORAY]: { emoji: "🎉", name: "hooray" },
  [REACTION.CONFUSED]: { emoji: "😕", name: "confused" },
  [REACTION.HEART]: { emoji: "❤️", name: "heart" },
  [REACTION.ROCKET]: { emoji: "🚀", name: "rocket" },
  [REACTION.EYES]: { emoji: "👀", name: "eyes" },
} as const satisfies Record<Reaction, { readonly emoji: string; readonly name: string }>;

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

/** One reaction: its emoji and count in a pill, lit where the reader gave it, its tooltip naming who did. */
function ReactionPill({ reaction }: { reaction: ReactionGroup }): React.JSX.Element {
  const { members, readerId, former } = useMemberDirectory();
  const face = REACTION_FACES[reaction.content];
  const actors = (reaction.by ?? []).map((person) =>
    githubActor(person, { members, readerId, former }),
  );
  const mine = actors.some((actor) => actor.kind === ACTOR_KIND.PERSON && actor.you);
  const names = actors.map((actor, at) => actorName(actor, { sentence: at > 0 }));
  const words = reactedWords(names, reaction.count, face.name);
  return (
    <li>
      <Tooltip label={words}>
        <span className="pull-request-reaction" data-mine={mine} role="img" aria-label={words}>
          <span aria-hidden="true">{face.emoji}</span>
          <span className="pull-request-reaction-count" aria-hidden="true">
            {reaction.count.toLocaleString()}
          </span>
        </span>
      </Tooltip>
    </li>
  );
}

/** The reactions something wears, under its words; nothing where it wears none. */
export function Reactions({
  reactions,
}: {
  reactions: readonly ReactionGroup[] | undefined;
}): React.JSX.Element | null {
  if (reactions === undefined || reactions.length === 0) return null;
  return (
    <ul className="pull-request-reactions" aria-label="Reactions">
      {reactions.map((reaction) => (
        <ReactionPill key={reaction.content} reaction={reaction} />
      ))}
    </ul>
  );
}

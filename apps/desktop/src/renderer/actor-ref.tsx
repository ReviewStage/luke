import { githubAvatarAt } from "@luke/features/account-picture";
import {
  AUTOMATION_RUN_STANDING,
  type AutomationRunStanding,
  automationOwner,
  automationRunLine,
  automationRunStanding,
  automationTriggerText,
} from "@luke/features/automation-list-model";
import type { AutomationSummary } from "@luke/features/automation-wire";
import { automationNextText, automationOwnerName } from "@luke/panel/desktop/automation-words";
import { InlineRef } from "@luke/panel/inline-ref";
import { useActorDoor } from "@luke/panel/person-door";
import { GLYPH_STATE, type GlyphState, StateGlyph } from "@luke/panel/state-glyph";
import { RelativeTime } from "@luke/panel/tasks/relative-time";
import { useMinute } from "@luke/panel/tasks/task-time";
import { Tooltip } from "@luke/panel/tooltip";
import {
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  type AvatarSize,
  HoverCard,
  HoverCardHead,
  HoverCardNote,
  HoverCardRule,
  INLINE_REF_LOOK,
  TEXT_BUTTON_LINES,
  TextButton,
  WingFace,
} from "@luke/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  actorName,
  type GitHubActor,
  LUKE_ACTOR,
  type PersonActor,
  ROLE_WORDS,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import { BotIcon, ClockIcon, HistoryIcon, UserRoundIcon, UserRoundXIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AgentMark } from "./tasks/tab-look";

/**
 * actor-ref.tsx -- whoever did something, drawn one way wherever the window names them: a person on a circle, and Luke, an agent, or an automation by its glyph in a rounded square's box, on a solid tile in a facepile whose faces overlap.
 *
 * A person's circle is the shared `Avatar`: their sign-in picture once it
 * loads, and the first letter of their name on the hue read off their id
 * until then and where it fails, as a workspace's tile does; a member who left keeps their own
 * picture or letter, grayed and muted, their name saying they left, so
 * colour is never the only sign; someone the service names nobody for
 * stands on a quiet outline. Someone GitHub names
 * who is no member stands by their GitHub avatar, a person on a circle and
 * an App's bot on a square, its robot until the avatar loads, and its name
 * wears a quiet "bot" badge wherever it is said, as GitHub's own pages mark
 * one. A picture on GitHub's avatar host is asked for at twice the size it
 * is drawn, so a Retina screen draws it sharp and nothing larger is
 * fetched. Luke's square holds
 * his face in his own blue, an agent's its harness, swapped for the working
 * mark while it writes as its tab's glyph is, and an automation's its clock,
 * each its glyph alone on the ground beneath it, as a tab's is. In a
 * facepile (`ActorStack`) whose faces overlap each stands on one solid
 * neutral tile instead, so the face it overlaps never shows through it. A disc is one size per place
 * (`ACTOR_SIZE`), so a byline, a facepile, and a list row read level
 * whoever is in them. Named in a line, an actor is its mark and its name as
 * one target that hangs its card (`ActorRef`); a press opens what has a
 * page of its own: an agent's tab, an automation's page, a person's page,
 * the page of someone who left, or a GitHub account's on GitHub
 * (`person-door.tsx`); a card is read, never a door, since its name already is one. Every mark is
 * hidden from a screen reader, since its name always stands beside it or in
 * its card; a picture's address is masked by session replay as its text is.
 */

/** How large an actor is drawn: a sidebar task's creator at its time, a line's, a facepile's, a list row's, the sidebar's account, a card head's and a Settings row's, or a person's page's head. */
export const ACTOR_SIZE = {
  MARK: "mark",
  INLINE: "inline",
  STACK: "stack",
  ROW: "row",
  ACCOUNT: "account",
  CARD: "card",
  PAGE: "page",
} as const;

export type ActorSize = (typeof ACTOR_SIZE)[keyof typeof ACTOR_SIZE];

/** How many CSS pixels across each size draws its disc, which the shared `Avatar` draws at for the same size. */
const ACTOR_PIXELS = {
  [ACTOR_SIZE.MARK]: 14,
  [ACTOR_SIZE.INLINE]: 16,
  [ACTOR_SIZE.STACK]: 18,
  [ACTOR_SIZE.ROW]: 20,
  [ACTOR_SIZE.ACCOUNT]: 26,
  [ACTOR_SIZE.CARD]: 32,
  [ACTOR_SIZE.PAGE]: 48,
} as const satisfies Record<ActorSize, number>;

/** How many device pixels a picture is asked for per CSS pixel it is drawn at: a Retina screen's. */
const PICTURE_DENSITY = 2;

/** The glyph state an actor's work wears, which is a tab's own. */
const GLYPH_OF_STATE = {
  [ACTOR_STATE.WORKING]: GLYPH_STATE.WORKING,
  [ACTOR_STATE.FAILED]: GLYPH_STATE.FAILED,
  [ACTOR_STATE.REST]: GLYPH_STATE.REST,
} as const satisfies Record<ActorState, GlyphState>;

/** The disc a person's face is drawn at for each size an actor is. */
const AVATAR_OF_SIZE = {
  [ACTOR_SIZE.MARK]: AVATAR_SIZE.MARK,
  [ACTOR_SIZE.INLINE]: AVATAR_SIZE.INLINE,
  [ACTOR_SIZE.STACK]: AVATAR_SIZE.STACK,
  [ACTOR_SIZE.ROW]: AVATAR_SIZE.ROW,
  [ACTOR_SIZE.ACCOUNT]: AVATAR_SIZE.ACCOUNT,
  [ACTOR_SIZE.CARD]: AVATAR_SIZE.CARD,
  [ACTOR_SIZE.PAGE]: AVATAR_SIZE.PAGE,
} as const satisfies Record<ActorSize, AvatarSize>;

/** A picture's address at the size a disc draws it, which GitHub serves sized (`githubAvatarAt`). */
function pictureAt(pictureUrl: string | undefined, size: ActorSize): string | undefined {
  return pictureUrl === undefined
    ? undefined
    : githubAvatarAt(pictureUrl, ACTOR_PIXELS[size] * PICTURE_DENSITY);
}

/** A person's disc: their picture once it loads, and the first letter of `name` on the hue read off `id` until then and where it fails. */
function PersonDisc({
  id,
  name,
  pictureUrl,
  size,
}: {
  id: string;
  name: string;
  pictureUrl: string | undefined;
  size: ActorSize;
}): React.JSX.Element {
  const src = pictureAt(pictureUrl, size);
  return (
    <Avatar
      id={id}
      name={name}
      {...(src === undefined ? {} : { src })}
      size={AVATAR_OF_SIZE[size]}
      decorative
    />
  );
}

/** A square holding a glyph alone, bare or on its tile; an App's bot's avatar stands over its robot once it loads, since a bot's square never holds a letter. */
function GlyphSquare({
  name,
  glyph,
  size,
  tiled,
  src,
}: {
  name: string;
  glyph: ReactNode;
  size: ActorSize;
  tiled: boolean;
  src?: string | undefined;
}): React.JSX.Element {
  return (
    <Avatar
      name={name}
      {...(src === undefined ? {} : { src })}
      glyph={glyph}
      shape={AVATAR_SHAPE.SQUARE}
      size={AVATAR_OF_SIZE[size]}
      tiled={tiled}
      decorative
    />
  );
}

/** Someone the window cannot name, by the glyph for why, on the circle the mark outlines. */
function SomeoneDisc({ glyph, size }: { glyph: ReactNode; size: ActorSize }): React.JSX.Element {
  return <Avatar name="" glyph={glyph} size={AVATAR_OF_SIZE[size]} decorative />;
}

/** What stands on an actor's circle or square, at its size. */
function Face({
  actor,
  size,
  tiled,
}: {
  actor: Actor;
  size: ActorSize;
  tiled: boolean;
}): React.JSX.Element {
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return (
        <PersonDisc id={actor.userId} name={actor.name} pictureUrl={actor.pictureUrl} size={size} />
      );
    case ACTOR_KIND.LUKE:
      return <GlyphSquare name={actorName(actor)} glyph={<WingFace />} size={size} tiled={tiled} />;
    case ACTOR_KIND.AGENT:
      return (
        <GlyphSquare
          name={actorName(actor)}
          glyph={
            <StateGlyph
              glyph={<AgentMark provider={actor.provider} />}
              state={GLYPH_OF_STATE[actor.state]}
            />
          }
          size={size}
          tiled={tiled}
        />
      );
    case ACTOR_KIND.AUTOMATION:
      return (
        <GlyphSquare
          name={actorName(actor)}
          glyph={<StateGlyph glyph={<ClockIcon />} state={GLYPH_OF_STATE[actor.state]} />}
          size={size}
          tiled={tiled}
        />
      );
    case ACTOR_KIND.GITHUB:
      return actor.bot ? (
        <GlyphSquare
          name={actor.login}
          glyph={<BotIcon />}
          size={size}
          tiled={tiled}
          src={pictureAt(actor.avatarUrl, size)}
        />
      ) : (
        <PersonDisc id={actor.login} name={actor.login} pictureUrl={actor.avatarUrl} size={size} />
      );
    case ACTOR_KIND.SOMEONE:
      // A member who left keeps their own face, grayed by the mark, where the service still names them.
      if (actor.reason === SOMEONE_REASON.FORMER && actor.name !== undefined) {
        return (
          <PersonDisc
            id={actor.userId ?? actor.name}
            name={actor.name}
            pictureUrl={actor.pictureUrl}
            size={size}
          />
        );
      }
      return (
        <SomeoneDisc
          glyph={
            actor.reason === SOMEONE_REASON.FORMER ? (
              <UserRoundXIcon />
            ) : actor.reason === SOMEONE_REASON.EARLIER ? (
              <HistoryIcon />
            ) : (
              <UserRoundIcon />
            )
          }
          size={size}
        />
      );
  }
}

/** Whether the actor is a member who left whom the service still names, drawn by their own face, grayed. */
function leftWithFace(actor: Actor): boolean {
  return (
    actor.kind === ACTOR_KIND.SOMEONE &&
    actor.reason === SOMEONE_REASON.FORMER &&
    actor.name !== undefined
  );
}

/** What a screen reader hears after a name that is a member who left, since their grayed face is hidden from it. */
const LEFT_WORDS = " (former member)";

/** What a screen reader hears after the name of a member who left, set beside it; nothing for anyone else. */
export function LeftWords({ actor }: { actor: Actor }): React.JSX.Element | null {
  return leftWithFace(actor) ? <span className="visually-hidden">{LEFT_WORDS}</span> : null;
}

/** An actor's circle or square alone, at a size. */
export function ActorMark({
  actor,
  size = ACTOR_SIZE.INLINE,
  tiled = false,
}: {
  actor: Actor;
  size?: ActorSize;
  /** Whether a square stands on its solid tile rather than bare, as a facepile's overlapping faces do. */
  tiled?: boolean;
}): React.JSX.Element {
  return (
    <span
      className="actor-mark"
      data-kind={actor.kind}
      data-bot={actor.kind === ACTOR_KIND.GITHUB && actor.bot ? "true" : undefined}
      data-left={leftWithFace(actor) ? "true" : undefined}
      data-size={size}
      data-tiled={tiled ? "true" : undefined}
      aria-hidden="true"
    >
      <Face actor={actor} size={size} tiled={tiled} />
    </span>
  );
}

/**
 * What a screen reader hears of a teammate's task's creator, whose face the
 * row draws at its time: "(created by Charles Pan)". Note that a row says it
 * outside its time's slot, because the slot steps out while the row is
 * hovered or holds the keyboard.
 */
export function CreatorHeard({ actor }: { actor: Actor }): React.JSX.Element {
  const left = leftWithFace(actor) ? ", who left" : "";
  return <span className="visually-hidden">{`(created by ${actorName(actor)}${left})`}</span>;
}

/** The quiet badge the reader's own account wears beside its name. */
export function YouBadge(): React.JSX.Element {
  return <span className="actor-you">You</span>;
}

/** Whether the actor is an App's bot on GitHub, whose name wears its badge. */
function githubBot(actor: Actor): boolean {
  return actor.kind === ACTOR_KIND.GITHUB && actor.bot;
}

/** The quiet badge an App's bot on GitHub wears after its name, as GitHub's own pages mark one; nothing for anyone else. */
function BotBadge({ actor }: { actor: Actor }): React.JSX.Element | null {
  return githubBot(actor) ? <span className="actor-bot">bot</span> : null;
}

/** An actor's card head: its mark at a card's size, its name, which `onOpen` makes the press that opens its page, the line under it, and its corner. */
function ActorHead({
  actor,
  sub,
  corner,
  onOpen,
}: {
  actor: Actor;
  sub?: ReactNode;
  corner?: ReactNode;
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const you = actor.kind === ACTOR_KIND.PERSON && actor.you;
  // Note that the card names the reader by their name, beside its badge, since the card is about who they are.
  const name = actor.kind === ACTOR_KIND.PERSON ? actor.name : actorName(actor);
  return (
    <div className="actor-card-head">
      <ActorMark actor={actor} size={ACTOR_SIZE.CARD} />
      <HoverCardHead
        name={
          you ? (
            <span className="actor-card-name">
              {name}
              <YouBadge />
            </span>
          ) : onOpen === undefined ? (
            name
          ) : (
            <TextButton lines={TEXT_BUTTON_LINES.TWO} onClick={onOpen}>
              {name}
            </TextButton>
          )
        }
        sub={sub}
        corner={corner}
      />
    </div>
  );
}

/** A person's card: their face, name, email, and role, then what they last did here where the place knows. A press on their name, not the card, opens their page. */
export function PersonCard({
  actor,
  latest,
}: {
  actor: PersonActor;
  /** Their latest activity in this plan, in a line: "Edited Rollout · 2h ago". */
  latest?: ReactNode;
}): React.JSX.Element {
  return (
    <HoverCard data-actor-card={actor.kind}>
      <ActorHead
        actor={actor}
        sub={actor.email}
        corner={actor.role === undefined ? undefined : ROLE_WORDS[actor.role]}
      />
      {latest === undefined ? null : (
        <>
          <HoverCardRule />
          <HoverCardNote>{latest}</HoverCardNote>
        </>
      )}
    </HoverCard>
  );
}

/** Luke's card: his face, whose call he wrote on and when, then what he wrote here where the place knows. Read, never followed. */
export function LukeCard({
  sub,
  latest,
}: {
  /** When he wrote, and on whose call: "During Charles Pan’s call · 2h ago". */
  sub?: ReactNode;
  /** What he last wrote in this plan, in a line: "Edited Rollout and Risks". */
  latest?: ReactNode;
}): React.JSX.Element {
  return (
    <HoverCard data-actor-card={ACTOR_KIND.LUKE}>
      <ActorHead actor={LUKE_ACTOR} sub={sub} />
      {latest === undefined ? null : (
        <>
          <HoverCardRule />
          <HoverCardNote>{latest}</HoverCardNote>
        </>
      )}
    </HoverCard>
  );
}

/** What a card says of someone the window cannot name, by why. */
const SOMEONE_NOTES = {
  [SOMEONE_REASON.FORMER]: "No longer in this workspace.",
  [SOMEONE_REASON.UNNAMED]: "Luke can't say who made this change.",
  [SOMEONE_REASON.EARLIER]: "The plan before its history began.",
} as const;

/** Someone's card: the name the service still holds for a member who left, and why the window says no more. */
function SomeoneCard({
  actor,
}: {
  actor: Extract<Actor, { kind: typeof ACTOR_KIND.SOMEONE }>;
}): React.JSX.Element {
  const former = actor.reason === SOMEONE_REASON.FORMER;
  // Note that a named former member's head already says "Former member".
  const note = former && actor.name !== undefined ? undefined : SOMEONE_NOTES[actor.reason];
  return (
    <HoverCard data-actor-card={actor.kind}>
      <ActorHead
        actor={actor}
        sub={former && actor.name !== undefined ? "Former member" : undefined}
      />
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
    </HoverCard>
  );
}

/** What a GitHub account's card says it is, a person's or an App's bot's, and where a person stands. */
const GITHUB_WORDS = {
  USER: "GitHub user",
  APP: "GitHub app",
  OUTSIDE: "Not in this workspace",
} as const;

/** Someone on GitHub's card: their face, a person's login or an App's bot's name and badge, whether they are a person or an App's bot, and that a person is no member here. A press on their name opens their page on GitHub. */
function GitHubCard({ actor }: { actor: GitHubActor }): React.JSX.Element {
  return (
    <HoverCard data-actor-card={actor.kind}>
      <div className="actor-card-head">
        <ActorMark actor={actor} size={ACTOR_SIZE.CARD} />
        <HoverCardHead
          name={
            actor.bot ? (
              <span className="actor-card-name">
                {actorName(actor)}
                <BotBadge actor={actor} />
              </span>
            ) : (
              `@${actor.login}`
            )
          }
          sub={actor.bot ? GITHUB_WORDS.APP : GITHUB_WORDS.USER}
          corner={actor.bot ? undefined : GITHUB_WORDS.OUTSIDE}
        />
      </div>
    </HoverCard>
  );
}

/** Where an automation's work stands, as its tile wears it: its newest run's standing. */
const ACTOR_STATE_OF_RUN = {
  [AUTOMATION_RUN_STANDING.WORKING]: ACTOR_STATE.WORKING,
  [AUTOMATION_RUN_STANDING.FAILED]: ACTOR_STATE.FAILED,
  [AUTOMATION_RUN_STANDING.REST]: ACTOR_STATE.REST,
} as const satisfies Record<AutomationRunStanding, ActorState>;

/** An automation as its tile draws it: its clock, wearing where its newest run stands, under its name. */
export function automationActor(automation: AutomationSummary): Actor {
  return {
    kind: ACTOR_KIND.AUTOMATION,
    name: automation.name,
    state: ACTOR_STATE_OF_RUN[automationRunStanding(automation.lastRun)],
  };
}

/**
 * An automation's card: its clock, its name over what fires it, whose it
 * is at the corner, when it runs next, and how its last run went. Note
 * that it offers no way to the automation's page under a rule, because
 * the name it hangs from opens that page on a press; hung from a control
 * whose press does something else, the Inbox's group header, which folds,
 * its own name is that way instead (`onOpen`).
 */
export function AutomationCard({
  automation,
  workspaceName,
  onOpen,
}: {
  automation: AutomationSummary;
  /** The workspace's name, which a workspace automation's corner says. */
  workspaceName: string | undefined;
  /** Opens the automation's page from the card's name, where the control hanging the card opens nothing of its own. */
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const actor = automationActor(automation);
  const { lastRun } = automation;
  return (
    <HoverCard data-actor-card={actor.kind}>
      <ActorHead
        actor={actor}
        sub={automationTriggerText(automation.trigger, automation.repositories ?? [])}
        corner={automationOwnerName(automationOwner(automation), workspaceName)}
        onOpen={onOpen}
      />
      <HoverCardNote>{automationNextText(automation, now)}</HoverCardNote>
      {lastRun === null ? null : (
        <HoverCardNote>
          {"Last ran "}
          <RelativeTime at={lastRun.firedAt} now={now} hint={false} ago />
          {` · ${automationRunLine(lastRun, automation.mine === true ? undefined : "its creator")}`}
        </HoverCardNote>
      )}
    </HoverCard>
  );
}

/** The card an actor hangs where the place naming it adds nothing: a person's, someone's, or a GitHub account's; none for the rest, whose name stands as a pill. */
export function actorCard(actor: Actor): ReactNode {
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return <PersonCard actor={actor} />;
    case ACTOR_KIND.SOMEONE:
      return <SomeoneCard actor={actor} />;
    case ACTOR_KIND.GITHUB:
      return <GitHubCard actor={actor} />;
    default:
      return undefined;
  }
}

/**
 * An actor named in a line: its mark and its name as one target, hanging
 * `card`, or the card its kind hangs where the place adds nothing. With
 * `onOpen` it is a button that opens the actor's page, an agent's tab or an
 * automation's page; a person, someone who left, and a GitHub account open
 * their own (`useActorDoor`); otherwise its press is the line's own. With
 * `faceOnly` the mark stands alone, its name said to a screen reader and in
 * its card, for a line too short to hold the name; with `nameOnly` the name
 * stands alone, where the actor's face already stands beside the line.
 */
export function ActorRef({
  actor,
  card,
  onOpen,
  sentence = false,
  possessive = false,
  faceOnly = false,
  nameOnly = false,
}: {
  actor: Actor;
  card?: ReactNode;
  onOpen?: (() => void) | undefined;
  /** Whether the name stands inside a sentence: "you" rather than "You". */
  sentence?: boolean;
  /** Whether the name says whose: "your Mac", "Charles Pan’s call". */
  possessive?: boolean;
  /** Whether the mark stands without its name, which only a screen reader hears. */
  faceOnly?: boolean;
  /** Whether the name stands without its mark, whose face the line already draws. */
  nameOnly?: boolean;
}): React.JSX.Element {
  // A person's own door, their page or GitHub's, where the place hands none.
  const door = useActorDoor(actor);
  const open = onOpen ?? door;
  return (
    <InlineRef
      look={INLINE_REF_LOOK.WASH}
      glyph={nameOnly ? undefined : <ActorMark actor={actor} />}
      label={actorName(actor, { sentence, possessive })}
      labelHidden={faceOnly}
      state={githubBot(actor) ? <BotBadge actor={actor} /> : undefined}
      heard={leftWithFace(actor) ? LEFT_WORDS : undefined}
      onPress={open === undefined ? undefined : () => open()}
      hintLabel={actorName(actor)}
      card={card ?? actorCard(actor)}
      data-actor-ref=""
      data-kind={actor.kind}
    />
  );
}

/**
 * Words naming an actor in one row, centred on its disc: the words and the
 * `ActorRef` among them, each word string keeping its own spaces, since a
 * row drops a run of spaces standing alone.
 */
export function ActorLine({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="actor-words">{children}</span>;
}

/** One face of a facepile that hangs cards: what it says of the actor beyond their name, and its badge. */
export interface StackFace {
  /** What the face says beside the actor's name to a screen reader and in its pill, "Approved". */
  readonly says?: string;
  /** A small mark at the face's corner, a reviewer's standing. */
  readonly badge?: ReactNode;
}

/** What the face says of an actor to a screen reader and in its pill: their name, that they left where they did, and what the face says beside it. */
function faceName(actor: Actor, face: StackFace): string {
  const name = leftWithFace(actor) ? `${actorName(actor)}${LEFT_WORDS}` : actorName(actor);
  return face.says === undefined ? name : `${name} · ${face.says}`;
}

/** One face of a facepile that hangs its card: the actor's mark, tiled where the pile overlaps it, its badge, named to a screen reader by its name and what it says. */
function CardedFace({
  actor,
  face,
  tiled,
}: {
  actor: Actor;
  face: StackFace;
  tiled: boolean;
}): React.JSX.Element {
  const name = faceName(actor, face);
  return (
    <Tooltip label={name} card={actorCard(actor)}>
      <li className="actor-stack-face" aria-label={name}>
        <ActorMark actor={actor} size={ACTOR_SIZE.STACK} tiled={tiled} />
        {face.badge === undefined ? null : (
          <span className="actor-stack-badge" aria-hidden="true">
            {face.badge}
          </span>
        )}
      </li>
    </Tooltip>
  );
}

/** What a row of the count's card says of an actor: their name, a bot's badge after it, then what their face would say, wrapping within the card. */
function MoreFaceWords({ actor, face }: { actor: Actor; face: StackFace }): React.JSX.Element {
  return (
    <span className="actor-more-words">
      {faceName(actor, {})}
      {/* Note that a no-break space holds the badge to its name's line however the row wraps. */}
      {githubBot(actor) ? "\u00a0" : null}
      <BotBadge actor={actor} />
      {face.says === undefined ? null : ` · ${face.says}`}
    </span>
  );
}

/**
 * The count past a pile's last face, which hangs a card naming each actor
 * it counts by their mark and what their face would say, so nobody the pile
 * leaves out is left unnamed, and is read to a screen reader as that list.
 */
function MoreFaces({
  actors,
  faces,
  more,
}: {
  actors: readonly Actor[];
  faces: readonly StackFace[];
  more: string;
}): React.JSX.Element {
  const names = actors.map((actor, index) => faceName(actor, faces[index] ?? {}));
  const card = (
    <HoverCard data-actor-card="more">
      <ul className="actor-more-list">
        {actors.map((actor, index) => (
          // Note that the rest stand in the pile's own order, so each is keyed by where it stands.
          <li key={index} className="actor-more-row">
            <ActorMark actor={actor} size={ACTOR_SIZE.STACK} />
            <MoreFaceWords actor={actor} face={faces[index] ?? {}} />
          </li>
        ))}
      </ul>
    </HoverCard>
  );
  return (
    <Tooltip label={names.join(", ")} card={card}>
      <li className="actor-stack-more" aria-label={names.join(", ")}>
        {more}
      </li>
    </Tooltip>
  );
}

/**
 * Whether a pile's faces overlap, and so tile their squares: two or more
 * drawn, none wearing a badge. Note that a lone face overlaps nothing, and a
 * pile whose faces wear badges stands them apart (`desktop.css`), so their
 * squares stand bare as they do in a line.
 */
function overlaps(drawn: number, faces: readonly StackFace[] | undefined): boolean {
  return drawn > 1 && !(faces ?? []).slice(0, drawn).some((face) => face.badge !== undefined);
}

/**
 * Many actors as a facepile: the first `drawn`, each cut from the ground
 * behind it by a ring of that ground, a square on its solid tile where the
 * faces overlap, then how many more where `counted`;
 * a place whose words beside the pile already count them, "5 can edit",
 * draws no pill. Handed `faces`, one for each actor, each face hangs the
 * actor's card, wears its badge, and is
 * named to a screen reader, the pile a list under `label`, its count hanging
 * a card naming the rest; without them the pile is the words' picture
 * beside them and a screen reader skips it.
 */
export function ActorStack({
  actors,
  drawn = 4,
  counted = true,
  faces,
  label,
}: {
  actors: readonly Actor[];
  drawn?: number;
  counted?: boolean;
  faces?: readonly StackFace[];
  /** What a pile of faces is, to a screen reader: "Reviewers". */
  label?: string;
}): React.JSX.Element {
  const rest = counted ? actors.length - drawn : 0;
  const more = rest > 0 ? <span className="actor-stack-more">{`+${rest}`}</span> : null;
  const shown = actors.slice(0, drawn);
  const tiled = overlaps(shown.length, faces);
  if (faces === undefined) {
    return (
      <span className="actor-stack" aria-hidden="true">
        {shown.map((actor, index) => (
          // Note that a pile's order is its place's own and never moves under it, so a disc is keyed by where it stands.
          <ActorMark key={index} actor={actor} size={ACTOR_SIZE.STACK} tiled={tiled} />
        ))}
        {more}
      </span>
    );
  }
  return (
    <ul className="actor-stack" aria-label={label}>
      {shown.map((actor, index) => (
        // Note that a pile's order is its place's own and never moves under it, so a face is keyed by where it stands.
        <CardedFace key={index} actor={actor} face={faces[index] ?? {}} tiled={tiled} />
      ))}
      {rest > 0 ? (
        <MoreFaces actors={actors.slice(drawn)} faces={faces.slice(drawn)} more={`+${rest}`} />
      ) : null}
    </ul>
  );
}

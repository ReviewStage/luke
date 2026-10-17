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
import { HoverCard, HoverCardHead, HoverCardNote, HoverCardRule, WingFace } from "@luke/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  actorName,
  type GitHubActor,
  identityHue,
  identityLetter,
  LUKE_ACTOR,
  type PersonActor,
  ROLE_WORDS,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import { BotIcon, ClockIcon, HistoryIcon, UserRoundIcon, UserRoundXIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { automationNextText, automationOwnerName } from "./desktop/automation-words";
import { useActorDoor } from "./person-door";
import { GLYPH_STATE, type GlyphState, StateGlyph } from "./state-glyph";
import { RelativeTime } from "./tasks/relative-time";
import { AgentMark } from "./tasks/tab-look";
import { useMinute } from "./tasks/task-time";
import { Tooltip } from "./tooltip";

/**
 * actor-ref.tsx -- whoever did something, drawn one way wherever the window names them: a person on a circle, and Luke, an agent, or an automation by its glyph in a rounded square's box, on a solid tile in a facepile whose faces overlap.
 *
 * A person's circle holds their sign-in picture once it loads, and the first
 * letter of their name on the hue read off their id until then and where it
 * fails, as a workspace's tile does; a member who left keeps their own
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

/** How many CSS pixels across each size draws its disc, which `desktop.css`'s `--actor-size` says for the same size. */
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

/**
 * A picture once it loads, and `stand` until then and where it fails: a
 * person's letter on the hue read off `id`, or a bot's own glyph on its
 * tile, which never holds a letter. A picture GitHub serves is asked for at
 * the size the disc draws it (`githubAvatarAt`).
 */
function PictureFace({
  id,
  pictureUrl,
  size,
  stand,
}: {
  id: string;
  pictureUrl: string | undefined;
  size: ActorSize;
  stand: { readonly letter: string } | { readonly glyph: ReactNode };
}): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const [loadedUrl, setLoadedUrl] = useState<string | undefined>(undefined);
  const sized =
    pictureUrl === undefined
      ? undefined
      : githubAvatarAt(pictureUrl, ACTOR_PIXELS[size] * PICTURE_DENSITY);
  const url = sized !== failedUrl ? sized : undefined;
  const shown = url !== undefined && url === loadedUrl;
  const lettered = "letter" in stand;
  // Note that the stand-in stands until the picture has loaded, because a picture on the network may take a while, and goes once it has, so a transparent one shows nothing through.
  return (
    <span className="actor-face" data-hue={shown || !lettered ? undefined : identityHue(id)}>
      {shown ? null : lettered ? stand.letter : stand.glyph}
      {url === undefined ? null : (
        <img
          className="actor-picture"
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          data-loaded={String(shown)}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
        />
      )}
    </span>
  );
}

/** A person's picture once it loads, their letter on its hue until then and where it fails. */
function PersonFace({ actor, size }: { actor: PersonActor; size: ActorSize }): React.JSX.Element {
  return (
    <PictureFace
      id={actor.userId}
      pictureUrl={actor.pictureUrl}
      size={size}
      stand={{ letter: identityLetter(actor.name) }}
    />
  );
}

/** Someone on GitHub: their avatar once it loads, a person's letter or a bot's glyph until then. */
function GitHubFace({ actor, size }: { actor: GitHubActor; size: ActorSize }): React.JSX.Element {
  return (
    <PictureFace
      id={actor.login}
      pictureUrl={actor.avatarUrl}
      size={size}
      stand={actor.bot ? { glyph: <BotIcon /> } : { letter: identityLetter(actor.login) }}
    />
  );
}

/** What stands on an actor's circle or square, at its size. */
function Face({ actor, size }: { actor: Actor; size: ActorSize }): React.JSX.Element {
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return <PersonFace actor={actor} size={size} />;
    case ACTOR_KIND.LUKE:
      return (
        <span className="actor-face">
          <WingFace />
        </span>
      );
    case ACTOR_KIND.AGENT:
      return (
        <span className="actor-face">
          <StateGlyph
            glyph={<AgentMark provider={actor.provider} />}
            state={GLYPH_OF_STATE[actor.state]}
          />
        </span>
      );
    case ACTOR_KIND.AUTOMATION:
      return (
        <span className="actor-face">
          <StateGlyph glyph={<ClockIcon />} state={GLYPH_OF_STATE[actor.state]} />
        </span>
      );
    case ACTOR_KIND.GITHUB:
      return <GitHubFace actor={actor} size={size} />;
    case ACTOR_KIND.SOMEONE:
      // A member who left keeps their own face, grayed by the mark, where the service still names them.
      if (actor.reason === SOMEONE_REASON.FORMER && actor.name !== undefined) {
        return (
          <PictureFace
            id={actor.userId ?? actor.name}
            pictureUrl={actor.pictureUrl}
            size={size}
            stand={{ letter: identityLetter(actor.name) }}
          />
        );
      }
      return (
        <span className="actor-face">
          {actor.reason === SOMEONE_REASON.FORMER ? (
            <UserRoundXIcon />
          ) : actor.reason === SOMEONE_REASON.EARLIER ? (
            <HistoryIcon />
          ) : (
            <UserRoundIcon />
          )}
        </span>
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
      <Face actor={actor} size={size} />
    </span>
  );
}

/**
 * A face that is no actor's, drawn as a person's is: its picture on a circle
 * once it loads, and the first letter of its name on the hue read off `id`
 * until then and where it fails or there is none. For a picker whose options
 * have faces, such as the avatars Luke appears as on video, so its rows and
 * chip read as the window's other faces do. Hidden from a screen reader, as
 * every mark is, since its name stands beside it.
 */
export function PictureMark({
  id,
  name,
  pictureUrl,
  size = ACTOR_SIZE.INLINE,
}: {
  /** What the hue is read off: the option's own token. */
  id: string;
  /** Whose letter stands until the picture loads. */
  name: string;
  pictureUrl: string | undefined;
  size?: ActorSize;
}): React.JSX.Element {
  return (
    <span className="actor-mark" data-kind={ACTOR_KIND.PERSON} data-size={size} aria-hidden="true">
      <PictureFace
        id={id}
        pictureUrl={pictureUrl}
        size={size}
        stand={{ letter: identityLetter(name) }}
      />
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
            <button type="button" className="card-name-link" onClick={onOpen}>
              {name}
            </button>
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
 * its card, for a line too short to hold the name.
 */
export function ActorRef({
  actor,
  card,
  onOpen,
  sentence = false,
  possessive = false,
  faceOnly = false,
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
}): React.JSX.Element {
  const name = actorName(actor, { sentence, possessive });
  // A person's own door, their page or GitHub's, where the place hands none.
  const door = useActorDoor(actor);
  const open = onOpen ?? door;
  const inner = (
    <>
      <ActorMark actor={actor} />
      <span className={faceOnly ? "visually-hidden" : "actor-ref-name"}>{name}</span>
      {faceOnly ? null : <BotBadge actor={actor} />}
      <LeftWords actor={actor} />
    </>
  );
  return (
    <Tooltip label={actorName(actor)} card={card ?? actorCard(actor)}>
      {open === undefined ? (
        <span className="actor-ref" data-kind={actor.kind}>
          {inner}
        </span>
      ) : (
        <button type="button" className="actor-ref" data-kind={actor.kind} onClick={open}>
          {inner}
        </button>
      )}
    </Tooltip>
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

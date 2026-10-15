import {
  AUTOMATION_RUN_STANDING,
  type AutomationRunStanding,
  automationOwner,
  automationRunLine,
  automationRunStanding,
  automationTriggerText,
} from "@luke/features/automation-list-model";
import type { AutomationSummary } from "@luke/features/automation-wire";
import { WingFace } from "@luke/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  actorName,
  identityHue,
  identityLetter,
  LUKE_ACTOR,
  type PersonActor,
  ROLE_WORDS,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import { ClockIcon, HistoryIcon, UserRoundIcon, UserRoundXIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { automationNextText, automationOwnerName } from "./desktop/automation-words";
import { CardHead, CardNote, CardRule, HoverCard } from "./hover-card";
import { useMinute } from "./planning/plan-time";
import { RelativeTime } from "./planning/relative-time";
import { AgentMark } from "./planning/tab-look";
import { GLYPH_STATE, type GlyphState, StateGlyph } from "./state-glyph";
import { Tooltip } from "./tooltip";

/**
 * actor-ref.tsx -- whoever did something, drawn one way wherever the window names them: a person on a circle, and Luke, an agent, or an automation on a solid rounded square.
 *
 * A person's circle holds their sign-in picture once it loads, and the first
 * letter of their name on the hue read off their id until then and where it
 * fails, as a workspace's tile does; a member who left, or someone the
 * service names nobody for, stands on a quiet outline. Luke's square holds
 * his face in his own blue, an agent's its harness, swapped for the working
 * mark while it writes as its tab's glyph is, and an automation's its clock,
 * each on one solid neutral fill, never the ground showing through, so a
 * tile reads as the same object on any surface. A disc is one size per place
 * (`ACTOR_SIZE`), so a byline, a facepile, and a list row read level
 * whoever is in them. Named in a line, an actor is its mark and its name as
 * one target that hangs its card (`ActorRef`); a press opens what has a
 * page of its own, an agent or an automation, and a person's card is read
 * and not followed, since the window has no page for a person. Every mark is
 * hidden from a screen reader, since its name always stands beside it or in
 * its card; a picture's address is masked by session replay as its text is.
 */

/** How large an actor is drawn: a sidebar task's creator at its time, a line's, a facepile's, a list row's, the sidebar's account, or a card head's and a Settings row's. */
export const ACTOR_SIZE = {
  MARK: "mark",
  INLINE: "inline",
  STACK: "stack",
  ROW: "row",
  ACCOUNT: "account",
  CARD: "card",
} as const;

type ActorSize = (typeof ACTOR_SIZE)[keyof typeof ACTOR_SIZE];

/** The glyph state an actor's work wears, which is a tab's own. */
const GLYPH_OF_STATE = {
  [ACTOR_STATE.WORKING]: GLYPH_STATE.WORKING,
  [ACTOR_STATE.FAILED]: GLYPH_STATE.FAILED,
  [ACTOR_STATE.REST]: GLYPH_STATE.REST,
} as const satisfies Record<ActorState, GlyphState>;

/** A person's picture once it loads, their letter on its hue until then and where it fails. */
function PersonFace({ actor }: { actor: PersonActor }): React.JSX.Element {
  const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
  const [loadedUrl, setLoadedUrl] = useState<string | undefined>(undefined);
  const url = actor.pictureUrl !== failedUrl ? actor.pictureUrl : undefined;
  const shown = url !== undefined && url === loadedUrl;
  // Note that the letter stands until the picture has loaded, because a picture on the network may take a while, and goes once it has, so a transparent one shows no letter through.
  return (
    <span className="actor-face" data-hue={shown ? undefined : identityHue(actor.userId)}>
      {shown ? null : identityLetter(actor.name)}
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

/** What stands on an actor's circle or square. */
function Face({ actor }: { actor: Actor }): React.JSX.Element {
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return <PersonFace actor={actor} />;
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
    case ACTOR_KIND.SOMEONE:
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

/** An actor's circle or square alone, at a size. */
export function ActorMark({
  actor,
  size = ACTOR_SIZE.INLINE,
}: {
  actor: Actor;
  size?: ActorSize;
}): React.JSX.Element {
  return (
    <span className="actor-mark" data-kind={actor.kind} data-size={size} aria-hidden="true">
      <Face actor={actor} />
    </span>
  );
}

/** The quiet badge the reader's own account wears beside its name. */
export function YouBadge(): React.JSX.Element {
  return <span className="actor-you">You</span>;
}

/** An actor's card head: its mark at a card's size, its name, the line under it, and its corner. */
function ActorHead({
  actor,
  sub,
  corner,
}: {
  actor: Actor;
  sub?: ReactNode;
  corner?: ReactNode;
}): React.JSX.Element {
  const you = actor.kind === ACTOR_KIND.PERSON && actor.you;
  // Note that the card names the reader by their name, beside its badge, since the card is about who they are.
  const name = actor.kind === ACTOR_KIND.PERSON ? actor.name : actorName(actor);
  return (
    <div className="actor-card-head">
      <ActorMark actor={actor} size={ACTOR_SIZE.CARD} />
      <CardHead
        name={
          you ? (
            <span className="actor-card-name">
              {name}
              <YouBadge />
            </span>
          ) : (
            name
          )
        }
        sub={sub}
        corner={corner}
      />
    </div>
  );
}

/** A person's card: their face, name, email, and role, then what they last did here where the place knows. Read, never followed. */
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
          <CardRule />
          <CardNote>{latest}</CardNote>
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
          <CardRule />
          <CardNote>{latest}</CardNote>
        </>
      )}
    </HoverCard>
  );
}

/** What a card says of someone the window cannot name, by why. */
const SOMEONE_NOTES = {
  [SOMEONE_REASON.FORMER]: "No longer in this workspace. Their edits stay in the plan's history.",
  [SOMEONE_REASON.UNNAMED]: "Luke can't say who made this change.",
  [SOMEONE_REASON.EARLIER]: "The plan as it stood before its history began.",
} as const;

/** Someone's card: the name the service still holds for a member who left, and why the window says no more. */
function SomeoneCard({
  actor,
}: {
  actor: Extract<Actor, { kind: typeof ACTOR_KIND.SOMEONE }>;
}): React.JSX.Element {
  const former = actor.reason === SOMEONE_REASON.FORMER;
  return (
    <HoverCard data-actor-card={actor.kind}>
      <ActorHead
        actor={actor}
        sub={former && actor.name !== undefined ? "Former member" : undefined}
      />
      <CardNote>{SOMEONE_NOTES[actor.reason]}</CardNote>
    </HoverCard>
  );
}

/** What an automation's card's way to its page says. */
const OPEN_AUTOMATION = "Open automation";

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
 * is at the corner, when it runs next, how its last run went, and under a
 * rule the way to its page.
 */
export function AutomationCard({
  automation,
  workspaceName,
  onOpen,
}: {
  automation: AutomationSummary;
  /** The workspace's name, which a workspace automation's corner says. */
  workspaceName: string | undefined;
  onOpen: () => void;
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
      />
      <CardNote>{automationNextText(automation, now)}</CardNote>
      {lastRun === null ? null : (
        <CardNote>
          {"Last ran "}
          <RelativeTime at={lastRun.firedAt} now={now} hint={false} ago />
          {` · ${automationRunLine(lastRun)}`}
        </CardNote>
      )}
      <CardRule />
      <CardDoor label={OPEN_AUTOMATION} onOpen={onOpen} />
    </HoverCard>
  );
}

/** The card an actor hangs where the place naming it adds nothing: a person's or someone's; none for the rest, whose name stands as a pill. */
function actorCard(actor: Actor): ReactNode {
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return <PersonCard actor={actor} />;
    case ACTOR_KIND.SOMEONE:
      return <SomeoneCard actor={actor} />;
    default:
      return undefined;
  }
}

/**
 * An actor named in a line: its mark and its name as one target, hanging
 * `card`, or the card its kind hangs where the place adds nothing. With
 * `onOpen` it is a button that opens the actor's page, an agent's tab or an
 * automation's page; otherwise its press is the line's own.
 */
export function ActorRef({
  actor,
  card,
  onOpen,
  sentence = false,
  possessive = false,
}: {
  actor: Actor;
  card?: ReactNode;
  onOpen?: (() => void) | undefined;
  /** Whether the name stands inside a sentence: "you" rather than "You". */
  sentence?: boolean;
  /** Whether the name says whose: "your Mac", "Charles Pan’s call". */
  possessive?: boolean;
}): React.JSX.Element {
  const name = actorName(actor, { sentence, possessive });
  const inner = (
    <>
      <ActorMark actor={actor} />
      <span className="actor-ref-name">{name}</span>
    </>
  );
  return (
    <Tooltip label={actorName(actor)} card={card ?? actorCard(actor)}>
      {onOpen === undefined ? (
        <span className="actor-ref" data-kind={actor.kind}>
          {inner}
        </span>
      ) : (
        <button type="button" className="actor-ref" data-kind={actor.kind} onClick={onOpen}>
          {inner}
        </button>
      )}
    </Tooltip>
  );
}

/** A card's way to the page of what it is about, under its rule: "Open agent". Choosing it takes the card down (`tooltip.tsx`). */
export function CardDoor({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className="card-door" data-card-choice="" onClick={onOpen}>
      {label}
    </button>
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

/**
 * Many actors as a facepile: the first `drawn`, each cut from the ground
 * behind it by a ring of that ground, then how many more where `counted`;
 * a place whose words beside the pile already count them, "5 can edit",
 * draws no pill.
 */
export function ActorStack({
  actors,
  drawn = 4,
  counted = true,
}: {
  actors: readonly Actor[];
  drawn?: number;
  counted?: boolean;
}): React.JSX.Element {
  const rest = counted ? actors.length - drawn : 0;
  return (
    <span className="actor-stack" aria-hidden="true">
      {actors.slice(0, drawn).map((actor, index) => (
        // Note that a pile's order is its place's own and never moves under it, so a disc is keyed by where it stands.
        <ActorMark key={index} actor={actor} size={ACTOR_SIZE.STACK} />
      ))}
      {rest > 0 ? <span className="actor-stack-more">{`+${rest}`}</span> : null}
    </span>
  );
}

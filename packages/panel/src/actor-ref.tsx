import { githubAvatarAt } from "@repo/features/account-picture";
import {
  AUTOMATION_RUN_STANDING,
  type AutomationRunStanding,
  automationOwner,
  automationRunLine,
  automationRunStanding,
  automationTriggerText,
} from "@repo/features/automation-list-model";
import type { AutomationRunSummary, AutomationSummary } from "@repo/features/automation-wire";
import {
  AVATAR_SHAPE,
  AVATAR_SIZE,
  Avatar,
  type AvatarSize,
  type CommentAuthor,
  cn,
  FiringGlyph,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  INLINE_REF_LOOK,
  InlineRef,
  ProductMark,
  TEXT_BUTTON_LINES,
  TextButton,
  TIME_LOOK,
  Time,
  Tooltip,
  UNASSIGNED_WORDS,
  UnassignedAvatar,
  useMinute,
  VisuallyHidden,
} from "@repo/ui";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  APP_ACTOR,
  type AssigneeFace,
  actorName,
  type GitHubActor,
  type PersonActor,
  ROLE_WORDS,
  SOMEONE_REASON,
} from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { BotIcon, HistoryIcon, UserRoundIcon, UserRoundXIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useAutomation } from "./automation-directory.js";
import { automationNextText, automationOwnerName } from "./desktop/automation-words.js";
import { useCreator } from "./member-directory.js";
import { useActorDoor, usePreloadedPerson } from "./person-door.js";
import { GLYPH_STATE, type GlyphState, StateGlyph } from "./state-glyph.js";
import { AgentHoverCard } from "./tasks/agent-ref.js";
import { AgentMark } from "./tasks/tab-look.js";

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

const ACTOR_PIXELS = {
  [ACTOR_SIZE.MARK]: 14,
  [ACTOR_SIZE.INLINE]: 16,
  [ACTOR_SIZE.STACK]: 18,
  [ACTOR_SIZE.ROW]: 20,
  [ACTOR_SIZE.ACCOUNT]: 26,
  [ACTOR_SIZE.CARD]: 32,
  [ACTOR_SIZE.PAGE]: 48,
} as const satisfies Record<ActorSize, number>;

export function actorMarkWidth(size: ActorSize): string {
  return `${ACTOR_PIXELS[size]}px`;
}

const ACTOR_PILE = {
  NONE: "none",
  IN_PILE: "in-pile",
  IN_FACE: "in-face",
} as const;

type ActorPile = (typeof ACTOR_PILE)[keyof typeof ACTOR_PILE];

const FOR_OF_SIZE = {
  [ACTOR_SIZE.MARK]: "-right-actor-for-x -bottom-actor-for-y scale-60",
  [ACTOR_SIZE.INLINE]: "-right-actor-for-x -bottom-actor-for-y scale-68",
  [ACTOR_SIZE.STACK]: "-right-actor-for-x -bottom-actor-for-y scale-60",
  [ACTOR_SIZE.ROW]: "-right-actor-for-x -bottom-actor-for-y scale-80",
  [ACTOR_SIZE.ACCOUNT]: "-right-actor-for-x -bottom-actor-for-y scale-80",
  [ACTOR_SIZE.CARD]: "-right-actor-for-near -bottom-actor-for-near scale-100",
  [ACTOR_SIZE.PAGE]: "-right-actor-for-near -bottom-actor-for-near scale-100",
} as const satisfies Record<ActorSize, string>;

function squared(actor: Actor): boolean {
  return (
    actor.kind === ACTOR_KIND.APP ||
    actor.kind === ACTOR_KIND.AGENT ||
    actor.kind === ACTOR_KIND.AUTOMATION ||
    (actor.kind === ACTOR_KIND.GITHUB && actor.bot)
  );
}

function ringOf(actor: Actor, pile: ActorPile, tiled: boolean): string {
  if (pile === ACTOR_PILE.NONE) {
    return actor.kind === ACTOR_KIND.SOMEONE && !leftWithFace(actor) ? "shadow-actor-outline" : "";
  }
  if (squared(actor) && !tiled) return "";
  if (pile === ACTOR_PILE.IN_PILE && actor.kind === ACTOR_KIND.SOMEONE) {
    return "shadow-actor-outline-ring";
  }
  return "shadow-actor-ring";
}

const PICTURE_DENSITY = 2;

const GLYPH_OF_STATE = {
  [ACTOR_STATE.WORKING]: GLYPH_STATE.WORKING,
  [ACTOR_STATE.FAILED]: GLYPH_STATE.FAILED,
  [ACTOR_STATE.REST]: GLYPH_STATE.REST,
} as const satisfies Record<ActorState, GlyphState>;

const AVATAR_OF_SIZE = {
  [ACTOR_SIZE.MARK]: AVATAR_SIZE.MARK,
  [ACTOR_SIZE.INLINE]: AVATAR_SIZE.INLINE,
  [ACTOR_SIZE.STACK]: AVATAR_SIZE.STACK,
  [ACTOR_SIZE.ROW]: AVATAR_SIZE.ROW,
  [ACTOR_SIZE.ACCOUNT]: AVATAR_SIZE.ACCOUNT,
  [ACTOR_SIZE.CARD]: AVATAR_SIZE.CARD,
  [ACTOR_SIZE.PAGE]: AVATAR_SIZE.PAGE,
} as const satisfies Record<ActorSize, AvatarSize>;

function pictureAt(pictureUrl: string | undefined, size: ActorSize): string | undefined {
  return pictureUrl === undefined
    ? undefined
    : githubAvatarAt(pictureUrl, ACTOR_PIXELS[size] * PICTURE_DENSITY);
}

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

function GlyphSquare({
  name,
  glyph,
  size,
  tiled,
  branded = false,
  src,
}: {
  name: string;
  glyph: ReactNode;
  size: ActorSize;
  tiled: boolean;
  branded?: boolean;
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
      branded={branded}
      decorative
    />
  );
}

function SomeoneDisc({ glyph, size }: { glyph: ReactNode; size: ActorSize }): React.JSX.Element {
  return <Avatar name="" glyph={glyph} size={AVATAR_OF_SIZE[size]} decorative />;
}

function automationGlyph(actor: ActorOf<typeof ACTOR_KIND.AUTOMATION>): React.JSX.Element {
  const glyph =
    actor.trigger === undefined ? <GLYPH.AUTOMATION /> : <FiringGlyph of={actor.trigger} />;
  return <StateGlyph glyph={glyph} state={GLYPH_OF_STATE[actor.state]} />;
}

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
    case ACTOR_KIND.APP:
      return (
        <GlyphSquare
          name={actorName(actor)}
          glyph={<ProductMark small />}
          size={size}
          tiled={tiled}
          branded={actor.onGitHub === true}
        />
      );
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
          glyph={automationGlyph(actor)}
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

export function commentAuthor(actor: Actor): CommentAuthor {
  const picture = (url: string | undefined) => pictureAt(url, ACTOR_SIZE.ROW);
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return { name: actor.name, id: actor.userId, picture: picture(actor.pictureUrl) };
    case ACTOR_KIND.APP:
      return { name: actorName(actor), shape: AVATAR_SHAPE.SQUARE, glyph: <ProductMark small /> };
    case ACTOR_KIND.AGENT:
      return {
        name: actorName(actor),
        shape: AVATAR_SHAPE.SQUARE,
        glyph: (
          <StateGlyph
            glyph={<AgentMark provider={actor.provider} />}
            state={GLYPH_OF_STATE[actor.state]}
          />
        ),
      };
    case ACTOR_KIND.AUTOMATION:
      return {
        name: actorName(actor),
        shape: AVATAR_SHAPE.SQUARE,
        glyph: automationGlyph(actor),
      };
    case ACTOR_KIND.GITHUB:
      return actor.bot
        ? {
            name: actor.login,
            shape: AVATAR_SHAPE.SQUARE,
            glyph: <BotIcon />,
            picture: picture(actor.avatarUrl),
          }
        : { name: actor.login, picture: picture(actor.avatarUrl) };
    case ACTOR_KIND.SOMEONE:
      if (leftWithFace(actor)) {
        return {
          name: actorName(actor),
          id: actor.userId ?? actorName(actor),
          picture: picture(actor.pictureUrl),
        };
      }
      return {
        name: actorName(actor),
        glyph:
          actor.reason === SOMEONE_REASON.FORMER ? (
            <UserRoundXIcon />
          ) : actor.reason === SOMEONE_REASON.EARLIER ? (
            <HistoryIcon />
          ) : (
            <UserRoundIcon />
          ),
      };
  }
}

function leftWithFace(actor: Actor): boolean {
  return (
    actor.kind === ACTOR_KIND.SOMEONE &&
    actor.reason === SOMEONE_REASON.FORMER &&
    actor.name !== undefined
  );
}

const LEFT_WORDS = " (former member)";

export function LeftWords({ actor }: { actor: Actor }): React.JSX.Element | null {
  return leftWithFace(actor) ? <VisuallyHidden>{LEFT_WORDS}</VisuallyHidden> : null;
}

export function ActorMark({
  actor,
  size = ACTOR_SIZE.INLINE,
  tiled = false,
  forWhom,
  pile = ACTOR_PILE.NONE,
  overlapping = false,
}: {
  actor: Actor;
  size?: ActorSize;
  tiled?: boolean;
  forWhom?: Actor | undefined;
  pile?: ActorPile;
  overlapping?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "actor-mark relative inline-grid flex-none align-middle text-foreground",
        "[--state-glyph-size:var(--spacing-avatar-glyph-share)] [&_.state-glyph>:is(svg,img)]:size-full",
        squared(actor) ? "rounded-avatar-square" : "rounded-disc",
        actor.kind === ACTOR_KIND.APP &&
          "text-working [&_.ui-product-mark]:size-actor-mark-share! [&_.ui-product-mark]:text-inherit",
        actor.kind === ACTOR_KIND.SOMEONE && "text-muted-foreground",
        leftWithFace(actor) && "bg-actor-tile [&>*]:opacity-80 [&>*]:grayscale",
        ringOf(actor, pile, tiled),
        overlapping && "-ml-actor-overlap",
      )}
      data-kind={actor.kind}
      data-bot={actor.kind === ACTOR_KIND.GITHUB && actor.bot ? "true" : undefined}
      data-left={leftWithFace(actor) ? "true" : undefined}
      data-size={size}
      data-tiled={tiled ? "true" : undefined}
      aria-hidden="true"
    >
      <Face actor={actor} size={size} tiled={tiled} />
      {forWhom === undefined ? null : (
        <span
          className={cn(
            "actor-mark-for absolute inline-grid size-avatar-mark origin-bottom-right rounded-disc shadow-actor-for-ring",
            FOR_OF_SIZE[size],
          )}
          data-kind={forWhom.kind}
        >
          <Face actor={forWhom} size={ACTOR_SIZE.MARK} tiled={false} />
        </span>
      )}
    </span>
  );
}

export function UnassignedMark({
  size = ACTOR_SIZE.INLINE,
  decorative = false,
  hint = !decorative,
}: {
  size?: ActorSize;
  decorative?: boolean;
  hint?: boolean;
}): React.JSX.Element {
  const mark = (
    <span
      className="actor-mark relative inline-grid flex-none rounded-disc align-middle text-foreground [--state-glyph-size:var(--spacing-avatar-glyph-share)]"
      data-kind="unassigned"
      data-size={size}
      aria-hidden={decorative ? "true" : undefined}
    >
      <UnassignedAvatar size={AVATAR_OF_SIZE[size]} decorative={decorative} />
    </span>
  );
  return hint ? <Tooltip label={UNASSIGNED_WORDS}>{mark}</Tooltip> : mark;
}

function UnassignedHeard(): React.JSX.Element {
  return <VisuallyHidden>{`(${UNASSIGNED_WORDS.toLowerCase()})`}</VisuallyHidden>;
}

function AssigneeHeard({ actor }: { actor: Actor }): React.JSX.Element {
  const left = leftWithFace(actor) ? ", who left" : "";
  return <VisuallyHidden>{`(assigned to ${actorName(actor)}${left})`}</VisuallyHidden>;
}

export function AssigneeFaceMark({
  face,
  heard = true,
}: {
  face: AssigneeFace;
  heard?: boolean;
}): React.JSX.Element {
  return (
    <>
      {face.assignee === undefined ? (
        <UnassignedMark size={ACTOR_SIZE.MARK} decorative hint />
      ) : (
        <ActorMark actor={face.assignee} size={ACTOR_SIZE.MARK} />
      )}
      {heard ? <AssigneeFaceHeard face={face} /> : null}
    </>
  );
}

export function AssigneeFaceHeard({ face }: { face: AssigneeFace }): React.JSX.Element {
  return face.assignee === undefined ? (
    <UnassignedHeard />
  ) : (
    <AssigneeHeard actor={face.assignee} />
  );
}

const QUIET_BADGE =
  "shrink-0 rounded-ui-6 bg-fill-strong px-tight-gap text-caption font-ui-medium text-muted-foreground";

export function YouBadge(): React.JSX.Element {
  return <span className={`actor-you ${QUIET_BADGE}`}>You</span>;
}

function githubBot(actor: Actor): boolean {
  return actor.kind === ACTOR_KIND.GITHUB && actor.bot;
}

export function BotBadge({ actor }: { actor: Actor }): React.JSX.Element | null {
  return githubBot(actor) ? <span className={`actor-bot ${QUIET_BADGE}`}>bot</span> : null;
}

function ActorHead({
  actor,
  sub,
  onOpen,
}: {
  actor: Actor;
  sub?: ReactNode;
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const you = actor.kind === ACTOR_KIND.PERSON && actor.you;
  const name = actor.kind === ACTOR_KIND.PERSON ? actor.name : actorName(actor);
  return (
    <HoverCardHead
      mark={<ActorMark actor={actor} size={ACTOR_SIZE.CARD} />}
      name={
        you ? (
          <span className="actor-card-name inline-flex items-center gap-item-gap">
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
    />
  );
}

function subLine(...parts: readonly (string | undefined)[]): string | undefined {
  const said = parts.filter((part): part is string => part !== undefined && part !== "");
  return said.length === 0 ? undefined : said.join(" · ");
}

function LatestRow({ latest }: { latest: ReactNode }): React.JSX.Element {
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={<GLYPH.VERSION_CHANGES />}
      label={latest}
    />
  );
}

export function PersonCard({
  actor,
  latest,
}: {
  actor: PersonActor;
  latest?: ReactNode;
}): React.JSX.Element {
  usePreloadedPerson(actor.userId);
  return (
    <HoverCard data-actor-card={actor.kind}>
      <ActorHead
        actor={actor}
        sub={subLine(actor.email, actor.role === undefined ? undefined : ROLE_WORDS[actor.role])}
      />
      {latest === undefined ? null : <LatestRow latest={latest} />}
    </HoverCard>
  );
}

export function AppCard({
  sub,
  latest,
}: {
  sub?: ReactNode;
  latest?: ReactNode;
}): React.JSX.Element {
  return (
    <HoverCard data-actor-card={ACTOR_KIND.APP}>
      <ActorHead actor={APP_ACTOR} sub={sub} />
      {latest === undefined ? null : <LatestRow latest={latest} />}
    </HoverCard>
  );
}

const SOMEONE_NOTES = {
  [SOMEONE_REASON.FORMER]: "No longer in this workspace",
  [SOMEONE_REASON.UNNAMED]: "Who made this change isn't known.",
  [SOMEONE_REASON.EARLIER]: "The description before its history began",
} as const;

function SomeoneCard({
  actor,
}: {
  actor: Extract<Actor, { kind: typeof ACTOR_KIND.SOMEONE }>;
}): React.JSX.Element {
  const former = actor.reason === SOMEONE_REASON.FORMER;
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

const GITHUB_WORDS = {
  USER: "GitHub user",
  APP: "GitHub App",
  OUTSIDE: "Not in this workspace",
} as const;

function GitHubCard({ actor }: { actor: GitHubActor }): React.JSX.Element {
  return (
    <HoverCard data-actor-card={actor.kind}>
      <HoverCardHead
        mark={<ActorMark actor={actor} size={ACTOR_SIZE.CARD} />}
        name={
          actor.bot ? (
            <span className="actor-card-name inline-flex items-center gap-item-gap">
              {actorName(actor)}
              <BotBadge actor={actor} />
            </span>
          ) : (
            `@${actor.login}`
          )
        }
        sub={actor.bot ? GITHUB_WORDS.APP : subLine(GITHUB_WORDS.USER, GITHUB_WORDS.OUTSIDE)}
      />
    </HoverCard>
  );
}

const ACTOR_STATE_OF_RUN = {
  [AUTOMATION_RUN_STANDING.WORKING]: ACTOR_STATE.WORKING,
  [AUTOMATION_RUN_STANDING.FAILED]: ACTOR_STATE.FAILED,
  [AUTOMATION_RUN_STANDING.REST]: ACTOR_STATE.REST,
} as const satisfies Record<AutomationRunStanding, ActorState>;

export function automationActor(automation: AutomationSummary): Actor {
  return {
    kind: ACTOR_KIND.AUTOMATION,
    automationId: automation.id,
    name: automation.name,
    state: ACTOR_STATE_OF_RUN[automationRunStanding(automation.lastRun)],
    trigger: automation.trigger,
  };
}

export function automationRunActor(run: AutomationRunSummary, name: string): Actor {
  return {
    kind: ACTOR_KIND.AUTOMATION,
    name,
    state: ACTOR_STATE_OF_RUN[automationRunStanding(run)],
    trigger: run.firing,
  };
}

export function AutomationCard({
  automation,
  workspaceName,
  onOpen,
}: {
  automation: AutomationSummary;
  workspaceName: string | undefined;
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const actor = automationActor(automation);
  const { lastRun } = automation;
  const nextWords = automationNextText(automation, now);
  return (
    <HoverCard data-actor-card={actor.kind}>
      <ActorHead
        actor={actor}
        sub={subLine(
          automationTriggerText(automation.trigger, automation.repositories ?? []),
          automationOwnerName(automationOwner(automation), workspaceName, automation.mine === true),
        )}
        onOpen={onOpen}
      />
      {nextWords === undefined ? null : <HoverCardNote>{nextWords}</HoverCardNote>}
      {lastRun === null ? null : (
        <HoverCardNote>
          {"Last ran "}
          <Time at={lastRun.firedAt} now={now} hint={false} look={TIME_LOOK.AGO} />
          {` · ${automationRunLine(lastRun, automation.mine === true ? undefined : "its creator")}`}
        </HoverCardNote>
      )}
      <AutomationMaker automation={automation} now={now} />
    </HoverCard>
  );
}

function AutomationMaker({
  automation,
  now,
}: {
  automation: AutomationSummary;
  now: number;
}): React.JSX.Element | null {
  const maker = useCreator(
    automation.creatorId === undefined ? {} : { ownerId: automation.creatorId },
  );
  if (maker.kind === ACTOR_KIND.SOMEONE) return null;
  return (
    <>
      <HoverCardRule />
      <ProvenanceRow
        verb={PROVENANCE_VERB.CREATED}
        actor={maker}
        at={automation.createdAt}
        now={now}
      />
    </>
  );
}

type ActorOf<K extends Actor["kind"]> = Extract<Actor, { readonly kind: K }>;

function KnownAutomationActorCard({ automationId }: { automationId: string }): ReactNode {
  const known = useAutomation(automationId);
  return known === undefined ? undefined : (
    <AutomationCard automation={known.automation} workspaceName={known.workspaceName} />
  );
}

const ACTOR_CARD: { readonly [K in Actor["kind"]]: (actor: ActorOf<K>) => ReactNode } = {
  [ACTOR_KIND.PERSON]: (actor) => <PersonCard actor={actor} />,
  [ACTOR_KIND.SOMEONE]: (actor) => <SomeoneCard actor={actor} />,
  [ACTOR_KIND.GITHUB]: (actor) => <GitHubCard actor={actor} />,
  [ACTOR_KIND.APP]: () => <AppCard />,
  [ACTOR_KIND.AGENT]: (actor) =>
    actor.agentId === undefined ? undefined : (
      <AgentHoverCard actor={actor} agentId={actor.agentId} />
    ),
  [ACTOR_KIND.AUTOMATION]: (actor) =>
    actor.automationId === undefined ? undefined : (
      <KnownAutomationActorCard automationId={actor.automationId} />
    ),
};

function actorCardOf<K extends Actor["kind"]>(kind: K, actor: ActorOf<K>): ReactNode {
  return ACTOR_CARD[kind](actor);
}

export function actorCard(actor: Actor): ReactNode {
  return actorCardOf(actor.kind, actor);
}

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
  sentence?: boolean;
  possessive?: boolean;
  faceOnly?: boolean;
  nameOnly?: boolean;
}): React.JSX.Element {
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

export function ActorLine({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span className="actor-words inline-flex max-w-full min-w-0 items-center align-middle whitespace-pre">
      {children}
    </span>
  );
}

export interface StackFace {
  readonly says?: string;
  readonly badge?: ReactNode;
}

function faceName(actor: Actor, face: StackFace): string {
  const name = leftWithFace(actor) ? `${actorName(actor)}${LEFT_WORDS}` : actorName(actor);
  return face.says === undefined ? name : `${name} · ${face.says}`;
}

function CardedFace({
  actor,
  face,
  tiled,
  spacing,
}: {
  actor: Actor;
  face: StackFace;
  tiled: boolean;
  spacing: string;
}): React.JSX.Element {
  const name = faceName(actor, face);
  return (
    <Tooltip label={name} card={actorCard(actor)}>
      <li className={cn("actor-stack-face relative inline-flex", spacing)} aria-label={name}>
        <ActorMark actor={actor} size={ACTOR_SIZE.STACK} tiled={tiled} pile={ACTOR_PILE.IN_FACE} />
        {face.badge === undefined ? null : (
          <span
            className="actor-stack-badge absolute -right-ui-4 -bottom-ui-4 z-1 grid size-actor-badge place-items-center rounded-disc bg-actor-stack-ground [&_svg]:size-actor-badge-glyph [&_svg]:stroke-3"
            aria-hidden="true"
          >
            {face.badge}
          </span>
        )}
      </li>
    </Tooltip>
  );
}

function MoreFaceName({ actor }: { actor: Actor }): React.JSX.Element {
  return (
    <>
      {faceName(actor, {})}
      {githubBot(actor) ? "\u00a0" : null}
      <BotBadge actor={actor} />
    </>
  );
}

function MoreFaces({
  actors,
  faces,
  more,
  label,
  spacing,
}: {
  actors: readonly Actor[];
  faces: readonly StackFace[];
  more: string;
  label: string;
  spacing: string;
}): React.JSX.Element {
  const names = actors.map((actor, index) => faceName(actor, faces[index] ?? {}));
  const card = (
    <HoverCard data-actor-card="more">
      <HoverCardList label={label}>
        {actors.map((actor, index) => (
          <li key={index} data-actor-more="">
            <HoverCardRow
              glyph={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
              label={<MoreFaceName actor={actor} />}
              end={faces[index]?.says}
            />
          </li>
        ))}
      </HoverCardList>
    </HoverCard>
  );
  return (
    <Tooltip label={names.join(", ")} card={card}>
      <li className={cn(PILE_COUNT, spacing)} aria-label={names.join(", ")}>
        {more}
      </li>
    </Tooltip>
  );
}

const MORE_FACES_LABEL = "Everyone else";

const PILE_COUNT =
  "actor-stack-more inline-grid h-avatar-stack min-w-avatar-stack place-items-center rounded-ui-full bg-actor-tile px-tight-gap text-caption-inline font-ui-semibold text-muted-foreground tabular-nums shadow-actor-ring";

function pileSpacing(index: number, apart: boolean): string {
  if (index === 0) return "";
  return apart ? "ml-item-gap" : "-ml-actor-overlap";
}

function overlaps(drawn: number, faces: readonly StackFace[] | undefined): boolean {
  return drawn > 1 && !(faces ?? []).slice(0, drawn).some((face) => face.badge !== undefined);
}

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
  label?: string;
}): React.JSX.Element {
  const rest = counted ? actors.length - drawn : 0;
  const shown = actors.slice(0, drawn);
  const tiled = overlaps(shown.length, faces);
  if (faces === undefined) {
    return (
      <span className="actor-stack inline-flex items-center" aria-hidden="true">
        {shown.map((actor, index) => (
          <ActorMark
            key={index}
            actor={actor}
            size={ACTOR_SIZE.STACK}
            tiled={tiled}
            pile={ACTOR_PILE.IN_PILE}
            overlapping={index > 0}
          />
        ))}
        {rest > 0 ? (
          <span className={cn(PILE_COUNT, pileSpacing(shown.length, false))}>{`+${rest}`}</span>
        ) : null}
      </span>
    );
  }
  const apart = shown.some((_, index) => faces[index]?.badge !== undefined);
  return (
    <ul className="actor-stack m-0 inline-flex list-none items-center p-0" aria-label={label}>
      {shown.map((actor, index) => (
        <CardedFace
          key={index}
          actor={actor}
          face={faces[index] ?? {}}
          tiled={tiled}
          spacing={pileSpacing(index, apart)}
        />
      ))}
      {rest > 0 ? (
        <MoreFaces
          actors={actors.slice(drawn)}
          faces={faces.slice(drawn)}
          more={`+${rest}`}
          label={label ?? MORE_FACES_LABEL}
          spacing={pileSpacing(shown.length, apart)}
        />
      ) : null}
    </ul>
  );
}

export const PROVENANCE_VERB = {
  CREATED: "Created",
  STARTED: "Started",
  SHOWN: "Shown",
  OPENED: "Opened",
} as const;

export type ProvenanceVerb = (typeof PROVENANCE_VERB)[keyof typeof PROVENANCE_VERB];

export function ProvenanceRow({
  verb,
  actor,
  at,
  now,
  card,
  onOpen,
}: {
  verb: ProvenanceVerb;
  actor: Actor;
  at?: number | undefined;
  now: number;
  card?: ReactNode;
  onOpen?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      glyph={<ActorMark actor={actor} size={ACTOR_SIZE.MARK} />}
      label={
        <>
          {`${verb} by `}
          <ActorRef actor={actor} card={card} onOpen={onOpen} sentence nameOnly />
          {at === undefined ? null : (
            <>
              {" · "}
              <Time at={at} now={now} hint={false} look={TIME_LOOK.PROVENANCE} />
            </>
          )}
        </>
      }
    />
  );
}

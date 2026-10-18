import { githubUserAvatarUrl } from "@luke/features/account-picture";
import type { GitHubPerson } from "@luke/features/coding-agent-wire";
import type { ModelProvider } from "@luke/features/models-wire";
import {
  PLAN_ACTOR,
  type PlanEditor,
  type PlanLastEdit,
  type PlanSectionEdit,
} from "@luke/features/task-wire";
import {
  type FormerMember,
  WORKSPACE_ROLE,
  type WorkspaceMember,
  type WorkspaceRole,
} from "@luke/features/workspace-wire";
import { TAB_WORDS } from "./tab-strip-model.js";

/**
 * actor-model.ts -- whoever did something, as the window names them: a person, Luke, a coding agent, an automation, or someone it cannot name.
 *
 * Every place that says who wrote, said, started, or answered something
 * reads its actor here and draws it one way (`actor-ref.tsx`): a person on a
 * circle, their sign-in picture or the first letter of their name on a hue
 * read off their id; Luke, an agent, and an automation each on a solid
 * rounded square; and someone the window cannot name on a quiet outline. A
 * person is named by the reader's own words for them: "you" for the
 * reader's own, "your" for what is theirs. A member the wire names by
 * `{userId, name}` is read against the workspace's members, which add the
 * picture, email, and role, so the wire's every person field needs no
 * picture of its own; a member the read no longer lists has left.
 *
 * A plan's edit is named by its actor (`editActor`), and Luke's also by
 * whose call he wrote it on (`editCallOwner`). A person's or Luke's card
 * says what they last did in the plan, read off who last changed each of
 * its sections (`latestActivity`), which the window already holds.
 */

/** The kinds of actor the window names. */
export const ACTOR_KIND = {
  PERSON: "person",
  LUKE: "luke",
  AGENT: "agent",
  AUTOMATION: "automation",
  SOMEONE: "someone",
  GITHUB: "github",
} as const;

/** Where an agent's or an automation's work stands, as its tile wears it: the same three a tab's glyph wears. */
export const ACTOR_STATE = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type ActorState = (typeof ACTOR_STATE)[keyof typeof ACTOR_STATE];

/** Why the window cannot name someone: a member who left, a save the service names nobody for, or the one revision from before history. */
export const SOMEONE_REASON = {
  FORMER: "former",
  UNNAMED: "unnamed",
  EARLIER: "earlier",
} as const;

type SomeoneReason = (typeof SOMEONE_REASON)[keyof typeof SOMEONE_REASON];

/** A person as the window draws them; what the members read adds is absent until it answers. */
export interface PersonActor {
  readonly kind: typeof ACTOR_KIND.PERSON;
  readonly userId: string;
  readonly name: string;
  readonly pictureUrl?: string;
  readonly email?: string;
  readonly role?: WorkspaceRole;
  /** Whether this is the reader's own account. */
  readonly you: boolean;
}

export type Actor =
  | PersonActor
  | { readonly kind: typeof ACTOR_KIND.LUKE }
  | {
      readonly kind: typeof ACTOR_KIND.AGENT;
      /** The agent's id, which tells two agents of one name apart; absent where an older service named none. */
      readonly agentId?: string | undefined;
      /** The task the agent works on, where the place naming it knows it, which its card and its tab are read under. */
      readonly taskId?: string | undefined;
      readonly name: string;
      readonly provider: ModelProvider | undefined;
      readonly state: ActorState;
    }
  | {
      readonly kind: typeof ACTOR_KIND.AUTOMATION;
      readonly name: string;
      readonly state: ActorState;
    }
  | {
      readonly kind: typeof ACTOR_KIND.SOMEONE;
      readonly reason: SomeoneReason;
      /** The name the service still holds for a member who left; none for the rest. */
      readonly name?: string;
      /** A member who left's account id, which their page is opened by; none for the rest. */
      readonly userId?: string;
      /** A member who left's sign-in picture, which the window draws grayed; none where the service names none. */
      readonly pictureUrl?: string;
    }
  | GitHubActor;

/** Someone GitHub names who is no member of the workspace, or an App's bot: by their login and their GitHub avatar. */
export interface GitHubActor {
  readonly kind: typeof ACTOR_KIND.GITHUB;
  readonly login: string;
  readonly avatarUrl?: string;
  /** Whether it is an App's bot, drawn on a square as Luke and the agents are, rather than a person's circle. */
  readonly bot: boolean;
}

/** The most sections an activity names before it counts the rest. */
const NAMED_SECTIONS = 3;

/** What an activity calls the words a plan holds before its first heading, as the version history does. */
const OPENING_SECTION = "Opening";

/** Joins a few names as a reader says them: "Goal, Rollout, and Risks". */
const NAMES = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/** A member's role in their workspace, in the words a row and a card say it. */
export const ROLE_WORDS = {
  [WORKSPACE_ROLE.OWNER]: "Owner",
  [WORKSPACE_ROLE.ADMIN]: "Admin",
  [WORKSPACE_ROLE.MEMBER]: "Member",
} as const satisfies Record<WorkspaceRole, string>;

/** Luke, who is always the same actor. */
export const LUKE_ACTOR: Actor = { kind: ACTOR_KIND.LUKE };

/** How many hues an identity's letter is drawn on: `--luke-color-identity-1` through `--luke-color-identity-6`. */
const IDENTITY_HUES = 6;

/** Splits a name into the characters a reader sees, an emoji's parts as one. */
const CHARACTERS = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The words for someone the window cannot name, by why, as a line's start says them. */
const SOMEONE_WORDS = {
  [SOMEONE_REASON.FORMER]: "Former member",
  [SOMEONE_REASON.UNNAMED]: "Someone",
  [SOMEONE_REASON.EARLIER]: "Earlier",
} as const satisfies Record<SomeoneReason, string>;

/**
 * The hue an identity is drawn in, from 1, read off its id alone, so a
 * rename keeps the mark its members know it by: a workspace's tile and a
 * person's letter alike.
 */
export function identityHue(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % IDENTITY_HUES) + 1;
}

/** A name's first character as a reader sees it, an emoji's whole, upper-cased; none for a blank name. */
export function identityLetter(name: string): string {
  const [first] = CHARACTERS.segment(name.trim());
  return first === undefined ? "" : first.segment.toUpperCase();
}

/** The suffix GitHub gives an App's bot's login, which its name drops since its square says it is one. */
const BOT_LOGIN_SUFFIX = "[bot]";

/** Whether a GitHub login is an App's bot's, which GitHub spells with its suffix. */
function isBotLogin(login: string): boolean {
  return login.endsWith(BOT_LOGIN_SUFFIX);
}

/**
 * Someone GitHub names by their login alone, as a line GitHub told an agent
 * of does: an App's bot by its login's suffix, on its robot, since GitHub
 * serves its App's picture only at an address the login does not name, and
 * a person by the avatar GitHub serves for their login.
 */
export function githubLoginActor(login: string): GitHubActor {
  const bot = isBotLogin(login);
  const actor: GitHubActor = { kind: ACTOR_KIND.GITHUB, login, bot };
  return bot ? actor : { ...actor, avatarUrl: githubUserAvatarUrl({ login }) };
}

/** What a GitHub account is called: its login, an App's bot's without the suffix GitHub gives it. */
function githubName(actor: GitHubActor): string {
  return actor.bot && isBotLogin(actor.login)
    ? actor.login.slice(0, -BOT_LOGIN_SUFFIX.length)
    : actor.login;
}

/** Lower-cases a line's opening word where the name stands inside a sentence. */
function inSentence(words: string, sentence: boolean): string {
  return sentence ? words.charAt(0).toLowerCase() + words.slice(1) : words;
}

/**
 * What an actor is called: the reader's own account "You", or "you" inside
 * a sentence, a person or a former member by name, Luke, an agent or an
 * automation by its title, and someone unnamed as "Someone". `possessive`
 * says whose: "Your pick" opening a phrase, "your Mac" inside a sentence, or
 * "Charles Pan’s".
 */
export function actorName(
  actor: Actor,
  { sentence = false, possessive = false }: { sentence?: boolean; possessive?: boolean } = {},
): string {
  if (actor.kind === ACTOR_KIND.PERSON && actor.you) {
    return inSentence(possessive ? "Your" : "You", sentence);
  }
  const name = (() => {
    switch (actor.kind) {
      case ACTOR_KIND.PERSON:
      case ACTOR_KIND.AGENT:
      case ACTOR_KIND.AUTOMATION:
        return actor.name;
      case ACTOR_KIND.LUKE:
        return "Luke";
      case ACTOR_KIND.SOMEONE:
        return actor.name ?? inSentence(SOMEONE_WORDS[actor.reason], sentence);
      case ACTOR_KIND.GITHUB:
        return githubName(actor);
    }
  })();
  return possessive ? `${name}’s` : name;
}

/**
 * A member named on the wire, as the window draws them: read against the
 * workspace's `members` for their picture, email, and role, and as the
 * reader where the id is the reader's own. While the members are unread
 * the wire's name stands alone; once read, a member they no longer list has
 * left the workspace, and keeps the picture `former` names them by. A ref the service named nobody for is someone unnamed.
 */
export function personActor(
  ref: { readonly userId: string; readonly name: string } | undefined,
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor {
  if (ref === undefined) return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };
  const you = readerId !== undefined && ref.userId === readerId;
  const member = members?.find((each) => each.userId === ref.userId);
  if (members !== undefined && member === undefined && !you) {
    // Note that the read of who left names them as their account does now, so a name changed since the work stood is the new one.
    const named = former?.find((each) => each.userId === ref.userId);
    const left = {
      kind: ACTOR_KIND.SOMEONE,
      reason: SOMEONE_REASON.FORMER,
      name: named?.name ?? ref.name,
      userId: ref.userId,
    } as const;
    const pictureUrl = named?.pictureUrl;
    return pictureUrl === undefined ? left : { ...left, pictureUrl };
  }
  const person: PersonActor = { kind: ACTOR_KIND.PERSON, userId: ref.userId, name: ref.name, you };
  return member === undefined ? person : memberActor(member, readerId);
}

/** A member as the members read lists them, the reader's own among them. */
export function memberActor(member: WorkspaceMember, readerId: string | undefined): PersonActor {
  const person: PersonActor = {
    kind: ACTOR_KIND.PERSON,
    userId: member.userId,
    name: member.name,
    email: member.email,
    role: member.role,
    you: readerId !== undefined && member.userId === readerId,
  };
  return member.pictureUrl === undefined ? person : { ...person, pictureUrl: member.pictureUrl };
}

/**
 * The signed-in account as the window draws it: the reader, by the name and
 * picture their sign-in holds. Note that an account stored without an id is
 * hued by its address, which names it as surely.
 */
export function accountActor(account: {
  readonly id?: string | undefined;
  readonly email: string;
  readonly name?: string | undefined;
  readonly pictureUrl?: string | undefined;
}): PersonActor {
  const person: PersonActor = {
    kind: ACTOR_KIND.PERSON,
    userId: account.id ?? account.email,
    name: account.name ?? account.email,
    email: account.email,
    you: true,
  };
  const { pictureUrl } = account;
  return pictureUrl === undefined ? person : { ...person, pictureUrl };
}

/**
 * Who created a task, for the reader: the member `createdBy` names, read
 * against the members. Note that a service before `createdBy` names only
 * the owner's id, so the reader's own task is drawn as their `account`, as
 * the members list them where they do, and another member's as the members
 * list that id; where neither knows a name, the creator is someone unnamed,
 * never a face with no name.
 */
export function creatorActor(
  task: { readonly createdBy?: PlanEditor | undefined; readonly ownerId?: string | undefined },
  reader: EditReader,
  account: PersonActor | undefined,
): Actor {
  const { createdBy, ownerId } = task;
  if (createdBy !== undefined || ownerId === undefined) {
    return personActor(createdBy, reader.members, reader.readerId, reader.former);
  }
  const member = reader.members?.find((each) => each.userId === ownerId);
  if (member !== undefined) return memberActor(member, reader.readerId);
  if (ownerId === reader.readerId && account !== undefined) return account;
  return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };
}

/**
 * Who created a task someone else created, as its row wears them: the
 * creator `creatorActor` names, where the creator is not the reader. Note
 * that a task is the reader's own, and wears nobody, wherever its creator's
 * id is theirs, and that one whose creator nobody names, from a service
 * before either field, or read before the reader's own id is known, wears
 * nobody either, since the row cannot say it is someone else's. A creator
 * whose account is gone is named by `ownerId` alone, and stands on the
 * quiet outline.
 */
export function teammateCreator(
  task: { readonly createdBy?: PlanEditor | undefined; readonly ownerId?: string | undefined },
  reader: EditReader,
): Actor | undefined {
  const creatorId = task.createdBy?.userId ?? task.ownerId;
  const { readerId } = reader;
  if (creatorId === undefined || readerId === undefined || creatorId === readerId) {
    return undefined;
  }
  return creatorActor(task, reader, undefined);
}

/**
 * Who reads a plan's edits, as each is named for them: the workspace's
 * members as read, the reader's own account id, and, where every edit is
 * the reader's own, as the account's template's are, the reader as their
 * account names them.
 */
export interface EditReader {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  /** Who the workspace's work names but left, whose pictures they keep, grayed. */
  readonly former?: readonly FormerMember[] | undefined;
  readonly owner?: PersonActor | undefined;
}

/** A coding agent an edit names, as the window found it among the task's agents: its harness and where its work stands. */
export interface EditAgent {
  readonly provider: ModelProvider | undefined;
  readonly state: ActorState;
}

/** The member an edit names, for the reader: the owner where every edit is theirs, a member as the directory reads them otherwise. */
function editPerson(edit: PlanLastEdit, reader: EditReader): Actor {
  return reader.owner ?? personActor(edit.by, reader.members, reader.readerId, reader.former);
}

/**
 * Who wrote an edit: a member, the reader among them; Luke; a coding agent
 * as its row names it now, wearing the harness and state of `agent` where
 * the window found it; nobody for the one revision from before history.
 */
export function editActor(
  edit: PlanLastEdit,
  reader: EditReader,
  agent?: EditAgent,
): Actor | undefined {
  switch (edit.actor) {
    case PLAN_ACTOR.DEVELOPER:
      return editPerson(edit, reader);
    case PLAN_ACTOR.NOTETAKER:
      return LUKE_ACTOR;
    case PLAN_ACTOR.AGENT:
      return {
        kind: ACTOR_KIND.AGENT,
        ...(edit.agentId === undefined ? undefined : { agentId: edit.agentId }),
        name: edit.label ?? TAB_WORDS.CODING_AGENT,
        provider: agent?.provider,
        state: agent?.state ?? ACTOR_STATE.REST,
      };
    case PLAN_ACTOR.EARLIER:
      return undefined;
  }
}

/** Whose call an edit was written on: the member it names, the reader among them; nobody for an edit off a call, or a call the service names nobody for. */
export function editCallOwner(edit: PlanLastEdit, reader: EditReader): Actor | undefined {
  if (!edit.duringCall) return undefined;
  if (reader.owner === undefined && edit.by === undefined) return undefined;
  return editPerson(edit, reader);
}

/** What an actor last did in a plan: the sections whose last change is theirs, in the plan's order, and the newest of those changes. */
export interface ActorActivity {
  readonly sections: readonly string[];
  readonly at: number;
}

/** Whether a section's last change is the actor's: a member's by their id, Luke's, or a coding agent's by its name. */
function changedBy(edit: PlanLastEdit, actor: Actor): boolean {
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return edit.actor === PLAN_ACTOR.DEVELOPER && edit.by?.userId === actor.userId;
    case ACTOR_KIND.LUKE:
      return edit.actor === PLAN_ACTOR.NOTETAKER;
    case ACTOR_KIND.AGENT:
      return (
        edit.actor === PLAN_ACTOR.AGENT &&
        (edit.agentId !== undefined && actor.agentId !== undefined
          ? edit.agentId === actor.agentId
          : edit.label === actor.name)
      );
    default:
      return false;
  }
}

/**
 * What an actor last did in a plan, read off who last changed each of its
 * sections: none where no section's last change is theirs, and none for an
 * automation or someone the window cannot name, whom no section names.
 */
export function latestActivity(
  edits: readonly PlanSectionEdit[],
  actor: Actor,
): ActorActivity | undefined {
  const theirs = edits.filter((edit) => changedBy(edit, actor));
  if (theirs.length === 0) return undefined;
  return {
    sections: theirs.map((edit) => (edit.section === "" ? OPENING_SECTION : edit.section)),
    at: Math.max(...theirs.map((edit) => edit.at)),
  };
}

/** An activity in a line: "Edited Rollout and Risks", or "Edited Goal, Rollout, and 3 more" past a few. */
export function activityWords(activity: ActorActivity): string {
  const { sections } = activity;
  const named =
    sections.length <= NAMED_SECTIONS
      ? sections
      : [...sections.slice(0, NAMED_SECTIONS - 1), `${sections.length - NAMED_SECTIONS + 1} more`];
  return `Edited ${NAMES.format(named)}`;
}

/**
 * Whether two agents are one: by their ids where both carry one, since two
 * agents may share a title, and by name only between two an older service
 * named no id for. Note that an agent with an id is never one with an agent
 * without, because a name matching each of two agents that differ by id
 * would make the pile hide one of them, depending on which section stood first.
 */
function sameAgent(
  one: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>,
  other: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>,
): boolean {
  if (one.agentId === undefined || other.agentId === undefined) {
    return one.agentId === other.agentId && one.name === other.name;
  }
  return one.agentId === other.agentId;
}

/** Whether two actors are one: a member by their id, an agent as `sameAgent` says, an automation by its name, someone by why, their account id, and the name they go by, someone on GitHub by their login in any case. */
function sameActor(one: Actor, other: Actor): boolean {
  switch (one.kind) {
    case ACTOR_KIND.PERSON:
      return other.kind === ACTOR_KIND.PERSON && other.userId === one.userId;
    case ACTOR_KIND.LUKE:
      return other.kind === ACTOR_KIND.LUKE;
    case ACTOR_KIND.AGENT:
      return other.kind === ACTOR_KIND.AGENT && sameAgent(one, other);
    case ACTOR_KIND.AUTOMATION:
      return other.kind === one.kind && other.name === one.name;
    case ACTOR_KIND.SOMEONE:
      // Note that two who left may share a name, so their account ids tell them apart.
      return (
        other.kind === ACTOR_KIND.SOMEONE &&
        other.reason === one.reason &&
        other.userId === one.userId &&
        other.name === one.name
      );
    case ACTOR_KIND.GITHUB:
      // Note that GitHub reads a login whatever its case, and its answers do not always spell one alike.
      return (
        other.kind === ACTOR_KIND.GITHUB && other.login.toLowerCase() === one.login.toLowerCase()
      );
  }
}

/** Each actor once, where it first stands, as a facepile draws who did a thing. */
export function distinctActors(actors: readonly Actor[]): readonly Actor[] {
  return actors.filter((actor, at) => actors.findIndex((each) => sameActor(each, actor)) === at);
}

/**
 * Where someone a pull request names on GitHub is drawn: the workspace's
 * members as read and the reader's id, which name a teammate.
 */
export interface GitHubPlace {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  /** Who the workspace's work names but left, whose pictures a linked login who left keeps. */
  readonly former?: readonly FormerMember[] | undefined;
}

/**
 * Someone a pull request names on GitHub, as the window draws them. A
 * GitHub account linked to a member is that member, by the name the
 * members read gives them, or the login while it is unread. Anyone else is
 * themself on GitHub: a person's circle, or an App's bot's square, Luke's
 * own App's bot among them.
 */
export function githubActor(person: GitHubPerson, place: GitHubPlace): Actor {
  if (person.userId !== undefined) {
    const member = place.members?.find((each) => each.userId === person.userId);
    const ref = { userId: person.userId, name: member?.name ?? person.login };
    return personActor(ref, place.members, place.readerId, place.former);
  }
  const actor: GitHubActor = { kind: ACTOR_KIND.GITHUB, login: person.login, bot: person.bot };
  return person.avatarUrl === undefined ? actor : { ...actor, avatarUrl: person.avatarUrl };
}

import { githubUserAvatarUrl } from "@repo/features/account-picture";
import type { GitHubPerson } from "@repo/features/agent-wire";
import type { AutomationFiring, AutomationTrigger } from "@repo/features/automation-wire";
import type { ModelProvider } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  DESCRIPTION_ACTOR,
  type DescriptionEditor,
  type DescriptionLastEdit,
  type DescriptionSectionEdit,
  type TaskOrigin,
} from "@repo/features/task-wire";
import { andList } from "@repo/features/words";
import {
  type FormerMember,
  WORKSPACE_ROLE,
  type WorkspaceMember,
  type WorkspaceRole,
} from "@repo/features/workspace-wire";
import { TAB_WORDS } from "./tab-strip-model.js";

export const ACTOR_KIND = {
  PERSON: "person",
  APP: "app",
  AGENT: "agent",
  AUTOMATION: "automation",
  SOMEONE: "someone",
  GITHUB: "github",
} as const;

export const ACTOR_STATE = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type ActorState = (typeof ACTOR_STATE)[keyof typeof ACTOR_STATE];

export const SOMEONE_REASON = {
  FORMER: "former",
  UNNAMED: "unnamed",
  EARLIER: "earlier",
} as const;

type SomeoneReason = (typeof SOMEONE_REASON)[keyof typeof SOMEONE_REASON];

export interface PersonActor {
  readonly kind: typeof ACTOR_KIND.PERSON;
  readonly userId: string;
  readonly name: string;
  readonly pictureUrl?: string;
  readonly email?: string;
  readonly role?: WorkspaceRole;
  readonly you: boolean;
}

export type Actor =
  | PersonActor
  | {
      readonly kind: typeof ACTOR_KIND.APP;
      readonly onGitHub?: boolean;
    }
  | {
      readonly kind: typeof ACTOR_KIND.AGENT;
      readonly agentId?: string | undefined;
      readonly taskId?: string | undefined;
      readonly name: string;
      readonly provider: ModelProvider | undefined;
      readonly state: ActorState;
    }
  | {
      readonly kind: typeof ACTOR_KIND.AUTOMATION;
      readonly automationId?: string | undefined;
      readonly name: string;
      readonly state: ActorState;
      readonly trigger?: AutomationTrigger | AutomationFiring | undefined;
    }
  | {
      readonly kind: typeof ACTOR_KIND.SOMEONE;
      readonly reason: SomeoneReason;
      readonly name?: string;
      readonly userId?: string;
      readonly pictureUrl?: string;
    }
  | GitHubActor;

export interface GitHubActor {
  readonly kind: typeof ACTOR_KIND.GITHUB;
  readonly login: string;
  readonly avatarUrl?: string;
  readonly bot: boolean;
}

const OPENING_SECTION = "Opening";

export const ROLE_WORDS = {
  [WORKSPACE_ROLE.OWNER]: "Owner",
  [WORKSPACE_ROLE.ADMIN]: "Admin",
  [WORKSPACE_ROLE.MEMBER]: "Member",
} as const satisfies Record<WorkspaceRole, string>;

export const APP_ACTOR: Actor = { kind: ACTOR_KIND.APP };

const IDENTITY_HUES = 6;

const CHARACTERS = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const SOMEONE_WORDS = {
  [SOMEONE_REASON.FORMER]: "Former member",
  [SOMEONE_REASON.UNNAMED]: "Someone",
  [SOMEONE_REASON.EARLIER]: "Earlier",
} as const satisfies Record<SomeoneReason, string>;

export function identityHue(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % IDENTITY_HUES) + 1;
}

export function identityLetter(name: string): string {
  const [first] = CHARACTERS.segment(name.trim());
  return first === undefined ? "" : first.segment.toUpperCase();
}

const BOT_LOGIN_SUFFIX = "[bot]";

function isBotLogin(login: string): boolean {
  return login.endsWith(BOT_LOGIN_SUFFIX);
}

export function githubLoginActor(login: string): GitHubActor {
  const bot = isBotLogin(login);
  const actor: GitHubActor = { kind: ACTOR_KIND.GITHUB, login, bot };
  return bot ? actor : { ...actor, avatarUrl: githubUserAvatarUrl({ login }) };
}

function githubName(actor: GitHubActor): string {
  return actor.bot && isBotLogin(actor.login)
    ? actor.login.slice(0, -BOT_LOGIN_SUFFIX.length)
    : actor.login;
}

function inSentence(words: string, sentence: boolean): string {
  return sentence ? words.charAt(0).toLowerCase() + words.slice(1) : words;
}

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
      case ACTOR_KIND.APP:
        return PRODUCT_NAME;
      case ACTOR_KIND.SOMEONE:
        return actor.name ?? inSentence(SOMEONE_WORDS[actor.reason], sentence);
      case ACTOR_KIND.GITHUB:
        return githubName(actor);
    }
  })();
  return possessive ? `${name}’s` : name;
}

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

export function creatorActor(
  task: {
    readonly createdBy?: DescriptionEditor | undefined;
    readonly ownerId?: string | undefined;
  },
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

export function teammateCreator(
  task: {
    readonly createdBy?: DescriptionEditor | undefined;
    readonly ownerId?: string | undefined;
  },
  reader: EditReader,
): Actor | undefined {
  const creatorId = task.createdBy?.userId ?? task.ownerId;
  const { readerId } = reader;
  if (creatorId === undefined || readerId === undefined || creatorId === readerId) {
    return undefined;
  }
  return creatorActor(task, reader, undefined);
}

export interface AssigneeFace {
  readonly assignee: Actor | undefined;
}

function soleMember(reader: EditReader): boolean {
  return (reader.memberCount ?? reader.members?.length) === 1;
}

export function assigneeFace(
  task: { readonly assignee?: { readonly userId: string; readonly name: string } | undefined },
  reader: EditReader,
): AssigneeFace | undefined {
  const { assignee } = task;
  if (assignee === undefined) return soleMember(reader) ? undefined : { assignee: undefined };
  if (assignee.userId === reader.readerId) return undefined;
  return { assignee: personActor(assignee, reader.members, reader.readerId, reader.former) };
}

export interface OriginAgent {
  readonly name: string;
  readonly provider: ModelProvider | undefined;
  readonly state: ActorState;
  readonly taskId?: string | undefined;
  readonly taskName?: string | undefined;
  readonly automationName?: string | undefined;
}

export function originActor(
  origin: TaskOrigin | undefined,
  agent: OriginAgent | undefined,
): Actor | undefined {
  if (origin === undefined) return undefined;
  if (origin.actor === DESCRIPTION_ACTOR.NOTETAKER) return APP_ACTOR;
  if (agent?.automationName !== undefined) {
    return { kind: ACTOR_KIND.AUTOMATION, name: agent.automationName, state: ACTOR_STATE.REST };
  }
  return {
    kind: ACTOR_KIND.AGENT,
    ...(origin.agentId === undefined ? undefined : { agentId: origin.agentId }),
    ...(agent?.taskId === undefined ? undefined : { taskId: agent.taskId }),
    name: agent?.name ?? TAB_WORDS.AGENT,
    provider: agent?.provider,
    state: agent?.state ?? ACTOR_STATE.REST,
  };
}

export interface EditReader {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  readonly former?: readonly FormerMember[] | undefined;
  readonly memberCount?: number | undefined;
}

export interface EditAgent {
  readonly provider: ModelProvider | undefined;
  readonly state: ActorState;
}

function editPerson(edit: DescriptionLastEdit, reader: EditReader): Actor {
  return personActor(edit.by, reader.members, reader.readerId, reader.former);
}

export function editActor(
  edit: DescriptionLastEdit,
  reader: EditReader,
  agent?: EditAgent,
): Actor | undefined {
  switch (edit.actor) {
    case DESCRIPTION_ACTOR.DEVELOPER:
      return editPerson(edit, reader);
    case DESCRIPTION_ACTOR.NOTETAKER:
      return APP_ACTOR;
    case DESCRIPTION_ACTOR.AGENT:
      return {
        kind: ACTOR_KIND.AGENT,
        ...(edit.agentId === undefined ? undefined : { agentId: edit.agentId }),
        name: edit.label ?? TAB_WORDS.AGENT,
        provider: agent?.provider,
        state: agent?.state ?? ACTOR_STATE.REST,
      };
    case DESCRIPTION_ACTOR.EARLIER:
      return undefined;
  }
}

export interface ActorActivity {
  readonly sections: readonly string[];
  readonly at: number;
}

function changedBy(edit: DescriptionLastEdit, actor: Actor): boolean {
  switch (actor.kind) {
    case ACTOR_KIND.PERSON:
      return edit.actor === DESCRIPTION_ACTOR.DEVELOPER && edit.by?.userId === actor.userId;
    case ACTOR_KIND.APP:
      return edit.actor === DESCRIPTION_ACTOR.NOTETAKER;
    case ACTOR_KIND.AGENT:
      return (
        edit.actor === DESCRIPTION_ACTOR.AGENT &&
        (edit.agentId !== undefined && actor.agentId !== undefined
          ? edit.agentId === actor.agentId
          : edit.label === actor.name)
      );
    default:
      return false;
  }
}

export function latestActivity(
  edits: readonly DescriptionSectionEdit[],
  actor: Actor,
): ActorActivity | undefined {
  const theirs = edits.filter((edit) => changedBy(edit, actor));
  if (theirs.length === 0) return undefined;
  return {
    sections: theirs.map((edit) => (edit.section === "" ? OPENING_SECTION : edit.section)),
    at: Math.max(...theirs.map((edit) => edit.at)),
  };
}

export function activityWords(activity: ActorActivity): string {
  return `Edited ${andList(activity.sections)}`;
}

function sameAgent(
  one: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>,
  other: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>,
): boolean {
  if (one.agentId === undefined || other.agentId === undefined) {
    return one.agentId === other.agentId && one.name === other.name;
  }
  return one.agentId === other.agentId;
}

function sameActor(one: Actor, other: Actor): boolean {
  switch (one.kind) {
    case ACTOR_KIND.PERSON:
      return other.kind === ACTOR_KIND.PERSON && other.userId === one.userId;
    case ACTOR_KIND.APP:
      return other.kind === ACTOR_KIND.APP;
    case ACTOR_KIND.AGENT:
      return other.kind === ACTOR_KIND.AGENT && sameAgent(one, other);
    case ACTOR_KIND.AUTOMATION:
      return other.kind === one.kind && other.name === one.name;
    case ACTOR_KIND.SOMEONE:
      return (
        other.kind === ACTOR_KIND.SOMEONE &&
        other.reason === one.reason &&
        other.userId === one.userId &&
        other.name === one.name
      );
    case ACTOR_KIND.GITHUB:
      return (
        other.kind === ACTOR_KIND.GITHUB && other.login.toLowerCase() === one.login.toLowerCase()
      );
  }
}

export function distinctActors(actors: readonly Actor[]): readonly Actor[] {
  return actors.filter((actor, at) => actors.findIndex((each) => sameActor(each, actor)) === at);
}

export interface GitHubPlace {
  readonly members: readonly WorkspaceMember[] | undefined;
  readonly readerId: string | undefined;
  readonly former?: readonly FormerMember[] | undefined;
}

export function githubActor(person: GitHubPerson, place: GitHubPlace): Actor {
  if (person.userId !== undefined) {
    const member = place.members?.find((each) => each.userId === person.userId);
    const ref = { userId: person.userId, name: member?.name ?? person.login };
    return personActor(ref, place.members, place.readerId, place.former);
  }
  const actor: GitHubActor = { kind: ACTOR_KIND.GITHUB, login: person.login, bot: person.bot };
  return person.avatarUrl === undefined ? actor : { ...actor, avatarUrl: person.avatarUrl };
}

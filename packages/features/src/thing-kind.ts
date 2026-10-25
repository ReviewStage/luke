import {
  issueAddressOf,
  LINK_PLACE,
  type LinkPlace,
  type LinkPlaceKind,
  type NumberedAddress,
  pullRequestAddressOf,
} from "./link-grammar.js";
import { MENTION_KIND, type Mention } from "./mention-link.js";
import { OPERATOR_NAME } from "./model-label.js";
import type { KnownNames } from "./place-chip-model.js";
import { TERM } from "./words.js";

/**
 * thing-kind.ts -- every kind of thing the app names, and what the window calls each by now.
 *
 * A thing is named in words in two ways: a mention (`mention-link.ts`), a
 * plan, a file, an agent, a pull request's page, and a link to a place in
 * Luke (`link-grammar.ts`), an Inbox item, an automation, a version of a
 * plan. Both name some of the same things, a plan, a section, a page, an
 * agent, a person, so `THING_KIND` is the one list of them all, and a
 * mention or a place is read as the `Thing` it names (`thingOfMention`,
 * `thingOfPlace`) before anything draws it.
 *
 * What draws a kind is a table keyed by `THING_KIND` and typed over each
 * kind's own `Thing`, never a switch with a default: a kind added here
 * fails to compile until every table says how it is drawn, so no kind
 * falls through to a fallback nobody chose. Where a kind has nothing of
 * its own to draw yet, its entry says so by name (`NO_LIVE_NAME` here,
 * `OWN_CARD` beside the cards in the panel), so what is left to fill in
 * is a list one search finds. This one holds the live name: the name the
 * window holds for a thing now, which a chip calls it by over, or after,
 * the words it was written with.
 *
 * A pull request's and a GitHub issue's page are mentioned as links, so a
 * link is read as one of them where its address is one, and as a page of
 * an integration's or a site's otherwise. A skill, a repository, and a
 * workspace are kinds no mention or link names yet; their rows will.
 */

/** The kinds no mention or link has a kind of its own for. */
const OWN_KIND = {
  PULL_REQUEST: "pull-request",
  ISSUE: "issue",
  SKILL: "skill",
  REPOSITORY: "repository",
  WORKSPACE: "workspace",
} as const;

/** Every kind of thing the app names; a mention's and a place's kinds spelled as their own, which `Thing` holds them to. */
export const THING_KIND = {
  PLAN: MENTION_KIND.TASK,
  SECTION: MENTION_KIND.SECTION,
  VERSION: LINK_PLACE.VERSION,
  COMMENT: LINK_PLACE.COMMENT,
  /** A turn of Luke's work on a plan. */
  TURN: LINK_PLACE.TURN,
  PAGE: MENTION_KIND.PAGE,
  AGENT: MENTION_KIND.AGENT,
  WORKER: LINK_PLACE.WORKER,
  LUKE: MENTION_KIND.LUKE,
  CHANGES: LINK_PLACE.CHANGES,
  PULL_REQUEST: OWN_KIND.PULL_REQUEST,
  PULL_REQUEST_THREAD: LINK_PLACE.PULL_REQUEST_THREAD,
  ISSUE: OWN_KIND.ISSUE,
  /** A page of an integration's, a Linear issue say, or of a well-known site. */
  LINK: MENTION_KIND.LINK,
  MESSAGE: LINK_PLACE.MESSAGE,
  INBOX: LINK_PLACE.INBOX,
  INBOX_ITEM: LINK_PLACE.INBOX_ITEM,
  AUTOMATIONS: LINK_PLACE.AUTOMATIONS,
  AUTOMATION: LINK_PLACE.AUTOMATION,
  AUTOMATION_RUN: LINK_PLACE.AUTOMATION_RUN,
  SETTINGS: LINK_PLACE.SETTINGS,
  PERSON: MENTION_KIND.PERSON,
  CHAT: LINK_PLACE.CHAT,
  ADMIN: LINK_PLACE.ADMIN,
  FILE: MENTION_KIND.FILE,
  FOLDER: MENTION_KIND.FOLDER,
  /** An MCP server. */
  SERVER: MENTION_KIND.SERVER,
  /** One of an MCP server's tools. */
  TOOL: MENTION_KIND.TOOL,
  SKILL: OWN_KIND.SKILL,
  REPOSITORY: OWN_KIND.REPOSITORY,
  WORKSPACE: OWN_KIND.WORKSPACE,
  DATE: MENTION_KIND.DATE,
} as const satisfies Record<string, Thing["kind"]>;

export type ThingKind = (typeof THING_KIND)[keyof typeof THING_KIND];

/** The places a mention names too, which are read as the mention's thing. */
type SharedPlaceKind =
  | typeof LINK_PLACE.TASK
  | typeof LINK_PLACE.SECTION
  | typeof LINK_PLACE.PAGE
  | typeof LINK_PLACE.AGENT
  | typeof LINK_PLACE.PERSON;

/**
 * A thing, by the ids that name it and nothing of its words: as a mention
 * names it, where one does, and as a link to its place does otherwise.
 */
export type Thing =
  | Exclude<Mention, { readonly kind: typeof MENTION_KIND.LINK }>
  | Extract<Mention, { readonly kind: typeof MENTION_KIND.LINK }>
  | { readonly kind: typeof OWN_KIND.PULL_REQUEST; readonly url: string }
  | { readonly kind: typeof OWN_KIND.ISSUE; readonly url: string }
  | Exclude<LinkPlace, { readonly kind: SharedPlaceKind }>
  /** A skill, by the name an agent runs it by. */
  | { readonly kind: typeof OWN_KIND.SKILL; readonly name: string }
  /** A repository, `owner/name`. */
  | { readonly kind: typeof OWN_KIND.REPOSITORY; readonly repository: string }
  /** A workspace, by its slug. */
  | { readonly kind: typeof OWN_KIND.WORKSPACE; readonly workspace: string };

/** A thing of the kind given. */
export type ThingOf<K extends ThingKind> = Extract<Thing, { readonly kind: K }>;

/** A place of the kind given. */
type PlaceOf<K extends LinkPlaceKind> = Extract<LinkPlace, { readonly kind: K }>;

/** What names a thing beyond the names the window holds: the heading its anchor names in the plan open, the key and title its provider answered for its page, and the repository, `owner/name`, of the place the thing is named in, which a pull request's or an issue's key leaves out where it is the same. */
export interface ThingSaid {
  readonly heading: string | undefined;
  readonly answered: { readonly key: string; readonly title: string } | undefined;
  readonly repository: string | null;
}

/** What a thing is called now, where the window holds it, and whether that wins over the words it was written with. */
export interface ThingName<T> {
  /**
   * Whether the name held wins over the words the thing was written with,
   * which name it as it was then; otherwise the words win, and the name
   * held stands in only where it was written bare.
   */
  readonly live: boolean;
  readonly held: (thing: T, known: KnownNames, said: ThingSaid) => string | undefined;
}

/** The live names, one entry per kind. */
type ThingNames = { readonly [K in ThingKind]: ThingName<ThingOf<K>> };

/** What a thing's name held answers: the name, where there is one, and whether it wins over the words. */
export interface ThingNameHeld {
  readonly live: boolean;
  readonly held: string | undefined;
}

/** Nothing said of a thing beyond the names the window holds. */
export const NOTHING_SAID: ThingSaid = {
  heading: undefined,
  answered: undefined,
  repository: null,
};

/** A kind the window holds no name of, which is called by the words it was written with. */
export const NO_LIVE_NAME: ThingName<Thing> = { live: false, held: () => undefined };

/** A provider's page, called by the key and title its provider answered, where it was written bare. */
const ANSWERED_NAME: ThingName<Thing> = {
  live: false,
  held: (_thing, _known, { answered }) =>
    answered === undefined ? undefined : `${answered.key} ${answered.title}`,
};

/**
 * What a pull request or an issue is called by its number: `#42` in the
 * repository the place stands on, compared whatever its case as GitHub reads
 * it, and `relay#42` in another.
 */
function numberedKey(address: NumberedAddress, repository: string | null): string {
  if (repository !== null && address.repository.toLowerCase() === repository.toLowerCase()) {
    return `#${address.number}`;
  }
  return `${address.repository.split("/")[1] ?? address.repository}#${address.number}`;
}

/**
 * A pull request's or an issue's page, called by the key and title its
 * provider answered where it was written bare, and by its key alone, as the
 * address says it, until then or where it never does: a refusal, no GitHub
 * App on the repository, a workspace without GitHub.
 */
function numberedName(
  addressOf: (url: string) => NumberedAddress | undefined,
): ThingName<{ readonly url: string }> {
  return {
    live: false,
    held: ({ url }, _known, { answered, repository }) => {
      if (answered !== undefined) return `${answered.key} ${answered.title}`;
      const address = addressOf(url);
      return address === undefined ? undefined : numberedKey(address, repository);
    },
  };
}

/** An agent's name held, said with the words given before it: "Changes by Ada". */
function byAgent(words: string, agentId: string, known: KnownNames): string | undefined {
  const agent = known.agents.get(agentId);
  return agent === undefined ? undefined : `${words} ${agent}`;
}

/** What each kind is called now. */
export const THING_NAME: ThingNames = {
  [THING_KIND.PLAN]: { live: true, held: (plan, known) => known.tasks.get(plan.taskId) },
  [THING_KIND.SECTION]: { live: true, held: (_section, _known, { heading }) => heading },
  [THING_KIND.VERSION]: {
    live: false,
    held: (version, known) => {
      const taskName = known.tasks.get(version.planId);
      return taskName === undefined ? undefined : `${taskName}, version ${version.revision}`;
    },
  },
  [THING_KIND.COMMENT]: NO_LIVE_NAME,
  [THING_KIND.TURN]: NO_LIVE_NAME,
  // Note that the window holds the pages of its open task alone, so a page of any other borrows none of their names.
  [THING_KIND.PAGE]: {
    live: true,
    held: (page, known) =>
      "taskId" in page && page.taskId === known.pagesTaskId
        ? known.pages.get(page.pageId)
        : undefined,
  },
  [THING_KIND.AGENT]: { live: true, held: (agent, known) => known.agents.get(agent.agentId) },
  [THING_KIND.WORKER]: NO_LIVE_NAME,
  [THING_KIND.LUKE]: { live: true, held: () => OPERATOR_NAME },
  [THING_KIND.CHANGES]: {
    live: false,
    held: (changes, known) => byAgent("Changes by", changes.agentId, known),
  },
  [THING_KIND.PULL_REQUEST]: numberedName(pullRequestAddressOf),
  [THING_KIND.PULL_REQUEST_THREAD]: NO_LIVE_NAME,
  [THING_KIND.ISSUE]: numberedName(issueAddressOf),
  [THING_KIND.LINK]: ANSWERED_NAME,
  [THING_KIND.MESSAGE]: {
    live: false,
    held: (message, known) => byAgent("Message from", message.agentId, known),
  },
  [THING_KIND.INBOX]: NO_LIVE_NAME,
  [THING_KIND.INBOX_ITEM]: { live: true, held: (item, known) => known.inboxItems.get(item.itemId) },
  [THING_KIND.AUTOMATIONS]: NO_LIVE_NAME,
  [THING_KIND.AUTOMATION]: {
    live: false,
    held: (automation, known) => known.automations.get(automation.automationId),
  },
  [THING_KIND.AUTOMATION_RUN]: {
    live: false,
    held: (run, known) => known.automations.get(run.automationId),
  },
  [THING_KIND.SETTINGS]: NO_LIVE_NAME,
  [THING_KIND.PERSON]: { live: true, held: (person, known) => known.people.get(person.userId) },
  [THING_KIND.CHAT]: NO_LIVE_NAME,
  [THING_KIND.ADMIN]: NO_LIVE_NAME,
  [THING_KIND.FILE]: NO_LIVE_NAME,
  [THING_KIND.FOLDER]: NO_LIVE_NAME,
  [THING_KIND.SERVER]: NO_LIVE_NAME,
  [THING_KIND.TOOL]: NO_LIVE_NAME,
  [THING_KIND.SKILL]: NO_LIVE_NAME,
  [THING_KIND.REPOSITORY]: NO_LIVE_NAME,
  [THING_KIND.WORKSPACE]: NO_LIVE_NAME,
  [THING_KIND.DATE]: NO_LIVE_NAME,
};

/**
 * What each kind is called in words, which a screen reader hears before a
 * thing's name, since the glyph that says it to the eye is hidden from one:
 * "pull request #42 Fix the refresh". Its nouns are the glossary's
 * (`words.ts`'s `TERM`) where it has one. Read it through `thingWordHeard`,
 * which leaves it out where the name already says it.
 */
export const THING_WORD: { readonly [K in ThingKind]: string } = {
  [THING_KIND.PLAN]: TERM.TASK.one,
  [THING_KIND.SECTION]: TERM.SECTION.one,
  [THING_KIND.VERSION]: "version",
  [THING_KIND.COMMENT]: "comment",
  [THING_KIND.TURN]: "turn",
  [THING_KIND.PAGE]: TERM.PAGE.one,
  [THING_KIND.AGENT]: TERM.AGENT.one,
  [THING_KIND.WORKER]: TERM.WORKER.one,
  [THING_KIND.LUKE]: "Luke",
  [THING_KIND.CHANGES]: "changes",
  [THING_KIND.PULL_REQUEST]: TERM.PULL_REQUEST.one,
  [THING_KIND.PULL_REQUEST_THREAD]: "review thread",
  [THING_KIND.ISSUE]: "issue",
  [THING_KIND.LINK]: "link",
  [THING_KIND.MESSAGE]: "message",
  [THING_KIND.INBOX]: "Inbox",
  [THING_KIND.INBOX_ITEM]: `Inbox ${TERM.INBOX_ITEM.one}`,
  [THING_KIND.AUTOMATIONS]: "automations",
  [THING_KIND.AUTOMATION]: "automation",
  [THING_KIND.AUTOMATION_RUN]: "automation run",
  [THING_KIND.SETTINGS]: "settings",
  [THING_KIND.PERSON]: TERM.MEMBER.one,
  [THING_KIND.CHAT]: "channel",
  [THING_KIND.ADMIN]: "admin",
  [THING_KIND.FILE]: TERM.FILE.one,
  [THING_KIND.FOLDER]: "folder",
  [THING_KIND.SERVER]: TERM.INTEGRATION.one,
  [THING_KIND.TOOL]: "tool",
  [THING_KIND.SKILL]: TERM.SKILL.one,
  [THING_KIND.REPOSITORY]: TERM.REPOSITORY.one,
  [THING_KIND.WORKSPACE]: "workspace",
  [THING_KIND.DATE]: "date",
};

/**
 * The word a screen reader hears before a thing's name: its kind's
 * (`THING_WORD`), or nothing where the name already starts with it, as
 * "Inbox", "Luke", and "Changes by Ada" do. Note that a link labelled with
 * words of its own, `[my queue](…/inbox)`, still says its kind.
 */
export function thingWordHeard(kind: ThingKind, name: string): string | undefined {
  const word = THING_WORD[kind];
  const lead = name.slice(0, word.length);
  const said = lead.localeCompare(word, undefined, { sensitivity: "base" }) === 0;
  // Note that the word must end where a word does, so "Taskbar" still says it is a task.
  const whole = !/^[\p{L}\p{N}]/u.test(name.slice(word.length));
  return said && whole ? undefined : word;
}

/** A place the thing it names already is. */
function asThing<P extends Thing>(place: P): Thing {
  return place;
}

/** The thing each kind of place names. */
const PLACE_THING: { readonly [K in LinkPlaceKind]: (place: PlaceOf<K>) => Thing } = {
  [LINK_PLACE.TASK]: (place) => ({ kind: THING_KIND.PLAN, taskId: place.planId }),
  [LINK_PLACE.SECTION]: (place) => ({
    kind: THING_KIND.SECTION,
    taskId: place.planId,
    anchor: place.anchor,
  }),
  [LINK_PLACE.PAGE]: (place) =>
    "planId" in place
      ? { kind: THING_KIND.PAGE, taskId: place.planId, pageId: place.pageId }
      : { kind: THING_KIND.PAGE, agentId: place.agentId, pageId: place.pageId },
  [LINK_PLACE.AGENT]: (place) =>
    place.planId === undefined
      ? { kind: THING_KIND.AGENT, agentId: place.agentId }
      : { kind: THING_KIND.AGENT, taskId: place.planId, agentId: place.agentId },
  [LINK_PLACE.PERSON]: (place) => ({ kind: THING_KIND.PERSON, userId: place.userId }),
  [LINK_PLACE.COMMENT]: asThing,
  [LINK_PLACE.VERSION]: asThing,
  [LINK_PLACE.TURN]: asThing,
  [LINK_PLACE.WORKER]: asThing,
  [LINK_PLACE.CHANGES]: asThing,
  [LINK_PLACE.PULL_REQUEST_THREAD]: asThing,
  [LINK_PLACE.MESSAGE]: asThing,
  [LINK_PLACE.INBOX]: asThing,
  [LINK_PLACE.INBOX_ITEM]: asThing,
  [LINK_PLACE.AUTOMATIONS]: asThing,
  [LINK_PLACE.AUTOMATION]: asThing,
  [LINK_PLACE.AUTOMATION_RUN]: asThing,
  [LINK_PLACE.SETTINGS]: asThing,
  [LINK_PLACE.CHAT]: asThing,
  [LINK_PLACE.ADMIN]: asThing,
};

/** A place read through its kind's own entry, which keeps the kind and the place it reads together. */
function placeThing<K extends LinkPlaceKind>(kind: K, place: PlaceOf<K>): Thing {
  return PLACE_THING[kind](place);
}

/** A thing's name read through its kind's own entry. */
function nameOf<K extends ThingKind>(
  kind: K,
  thing: ThingOf<K>,
  known: KnownNames,
  said: ThingSaid,
): ThingNameHeld {
  const { live, held } = THING_NAME[kind];
  return { live, held: held(thing, known, said) };
}

/** The thing a mention names: a link to a pull request's or a GitHub issue's page that one, and any other mention the thing it is. */
export function thingOfMention(mention: Mention): Thing {
  if (mention.kind !== MENTION_KIND.LINK) return mention;
  if (pullRequestAddressOf(mention.url) !== undefined) {
    return { kind: THING_KIND.PULL_REQUEST, url: mention.url };
  }
  if (issueAddressOf(mention.url) !== undefined) {
    return { kind: THING_KIND.ISSUE, url: mention.url };
  }
  return mention;
}

/** The thing a link to a place in Luke names. */
export function thingOfPlace(place: LinkPlace): Thing {
  return placeThing(place.kind, place);
}

/** What the window calls a thing now, by its kind's entry, and whether that wins over the words it was written with. */
export function thingName(thing: Thing, known: KnownNames, said: ThingSaid): ThingNameHeld {
  return nameOf(thing.kind, thing, known, said);
}

import {
  issueAddressOf,
  LINK_PLACE,
  type LinkPlace,
  type LinkPlaceKind,
  type NumberedAddress,
  pullRequestAddressOf,
} from "./link-grammar.js";
import { MENTION_KIND, type Mention } from "./mention-link.js";
import type { KnownNames } from "./place-chip-model.js";
import { PRODUCT_NAME } from "./product-name.js";
import { TERM } from "./words.js";

const OWN_KIND = {
  PULL_REQUEST: "pull-request",
  ISSUE: "issue",
  SKILL: "skill",
  REPOSITORY: "repository",
  WORKSPACE: "workspace",
} as const;

export const THING_KIND = {
  PLAN: MENTION_KIND.TASK,
  SECTION: MENTION_KIND.SECTION,
  VERSION: LINK_PLACE.VERSION,
  COMMENT: LINK_PLACE.COMMENT,
  PAGE: MENTION_KIND.PAGE,
  AGENT: MENTION_KIND.AGENT,
  WORKER: LINK_PLACE.WORKER,
  APP: MENTION_KIND.APP,
  CHANGES: LINK_PLACE.CHANGES,
  PULL_REQUEST: OWN_KIND.PULL_REQUEST,
  PULL_REQUEST_THREAD: LINK_PLACE.PULL_REQUEST_THREAD,
  ISSUE: OWN_KIND.ISSUE,
  LINK: MENTION_KIND.LINK,
  MESSAGE: LINK_PLACE.MESSAGE,
  HOME: LINK_PLACE.HOME,
  BOARD: LINK_PLACE.BOARD,
  INBOX: LINK_PLACE.INBOX,
  INBOX_ITEM: LINK_PLACE.INBOX_ITEM,
  AUTOMATIONS: LINK_PLACE.AUTOMATIONS,
  AUTOMATION: LINK_PLACE.AUTOMATION,
  AUTOMATION_RUN: LINK_PLACE.AUTOMATION_RUN,
  SETTINGS: LINK_PLACE.SETTINGS,
  PERSON: MENTION_KIND.PERSON,
  ADMIN: LINK_PLACE.ADMIN,
  FILE: MENTION_KIND.FILE,
  FOLDER: MENTION_KIND.FOLDER,
  SERVER: MENTION_KIND.SERVER,
  TOOL: MENTION_KIND.TOOL,
  SKILL: OWN_KIND.SKILL,
  REPOSITORY: OWN_KIND.REPOSITORY,
  WORKSPACE: OWN_KIND.WORKSPACE,
  DATE: MENTION_KIND.DATE,
} as const satisfies Record<string, Thing["kind"]>;

export type ThingKind = (typeof THING_KIND)[keyof typeof THING_KIND];

type SharedPlaceKind =
  | typeof LINK_PLACE.TASK
  | typeof LINK_PLACE.SECTION
  | typeof LINK_PLACE.PAGE
  | typeof LINK_PLACE.AGENT
  | typeof LINK_PLACE.PERSON;

export type Thing =
  | Exclude<Mention, { readonly kind: typeof MENTION_KIND.LINK }>
  | Extract<Mention, { readonly kind: typeof MENTION_KIND.LINK }>
  | { readonly kind: typeof OWN_KIND.PULL_REQUEST; readonly url: string }
  | { readonly kind: typeof OWN_KIND.ISSUE; readonly url: string }
  | Exclude<LinkPlace, { readonly kind: SharedPlaceKind }>
  | { readonly kind: typeof OWN_KIND.SKILL; readonly name: string }
  | { readonly kind: typeof OWN_KIND.REPOSITORY; readonly repository: string }
  | { readonly kind: typeof OWN_KIND.WORKSPACE; readonly workspace: string };

export type ThingOf<K extends ThingKind> = Extract<Thing, { readonly kind: K }>;

type PlaceOf<K extends LinkPlaceKind> = Extract<LinkPlace, { readonly kind: K }>;

export interface ThingSaid {
  readonly heading: string | undefined;
  readonly answered: { readonly key: string; readonly title: string } | undefined;
  readonly repository: string | null;
}

export interface ThingName<T> {
  readonly live: boolean;
  readonly held: (thing: T, known: KnownNames, said: ThingSaid) => string | undefined;
}

type ThingNames = { readonly [K in ThingKind]: ThingName<ThingOf<K>> };

export interface ThingNameHeld {
  readonly live: boolean;
  readonly held: string | undefined;
}

export const NOTHING_SAID: ThingSaid = {
  heading: undefined,
  answered: undefined,
  repository: null,
};

export const NO_LIVE_NAME: ThingName<Thing> = { live: false, held: () => undefined };

const ANSWERED_NAME: ThingName<Thing> = {
  live: false,
  held: (_thing, _known, { answered }) =>
    answered === undefined ? undefined : `${answered.key} ${answered.title}`,
};

function numberedKey(address: NumberedAddress, repository: string | null): string {
  if (repository !== null && address.repository.toLowerCase() === repository.toLowerCase()) {
    return `#${address.number}`;
  }
  return `${address.repository.split("/")[1] ?? address.repository}#${address.number}`;
}

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

function byAgent(words: string, agentId: string, known: KnownNames): string | undefined {
  const agent = known.agents.get(agentId);
  return agent === undefined ? undefined : `${words} ${agent}`;
}

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
  [THING_KIND.PAGE]: {
    live: true,
    held: (page, known) =>
      "taskId" in page && page.taskId === known.pagesTaskId
        ? known.pages.get(page.pageId)
        : undefined,
  },
  [THING_KIND.AGENT]: { live: true, held: (agent, known) => known.agents.get(agent.agentId) },
  [THING_KIND.WORKER]: NO_LIVE_NAME,
  [THING_KIND.APP]: { live: true, held: () => PRODUCT_NAME },
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
  [THING_KIND.HOME]: NO_LIVE_NAME,
  [THING_KIND.BOARD]: NO_LIVE_NAME,
  [THING_KIND.INBOX]: NO_LIVE_NAME,
  [THING_KIND.INBOX_ITEM]: { live: true, held: (item, known) => known.inboxItems.get(item.itemId) },
  [THING_KIND.AUTOMATIONS]: NO_LIVE_NAME,
  [THING_KIND.AUTOMATION]: {
    live: true,
    held: (automation, known) => known.automations.get(automation.automationId),
  },
  [THING_KIND.AUTOMATION_RUN]: {
    live: false,
    held: (run, known) => known.automations.get(run.automationId),
  },
  [THING_KIND.SETTINGS]: NO_LIVE_NAME,
  [THING_KIND.PERSON]: { live: true, held: (person, known) => known.people.get(person.userId) },
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

export const THING_WORD: { readonly [K in ThingKind]: string } = {
  [THING_KIND.PLAN]: TERM.TASK.one,
  [THING_KIND.SECTION]: TERM.SECTION.one,
  [THING_KIND.VERSION]: "version",
  [THING_KIND.COMMENT]: "comment",
  [THING_KIND.PAGE]: TERM.PAGE.one,
  [THING_KIND.AGENT]: TERM.AGENT.one,
  [THING_KIND.WORKER]: TERM.WORKER.one,
  [THING_KIND.APP]: PRODUCT_NAME,
  [THING_KIND.CHANGES]: "changes",
  [THING_KIND.PULL_REQUEST]: TERM.PULL_REQUEST.one,
  [THING_KIND.PULL_REQUEST_THREAD]: "review thread",
  [THING_KIND.ISSUE]: "issue",
  [THING_KIND.LINK]: "link",
  [THING_KIND.MESSAGE]: "message",
  [THING_KIND.HOME]: "Home",
  [THING_KIND.BOARD]: "tasks",
  [THING_KIND.INBOX]: "Inbox",
  [THING_KIND.INBOX_ITEM]: `Inbox ${TERM.INBOX_ITEM.one}`,
  [THING_KIND.AUTOMATIONS]: "automations",
  [THING_KIND.AUTOMATION]: "automation",
  [THING_KIND.AUTOMATION_RUN]: "automation run",
  [THING_KIND.SETTINGS]: "settings",
  [THING_KIND.PERSON]: TERM.MEMBER.one,
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

export function thingWordHeard(kind: ThingKind, name: string): string | undefined {
  const word = THING_WORD[kind];
  const lead = name.slice(0, word.length);
  const said = lead.localeCompare(word, undefined, { sensitivity: "base" }) === 0;
  const whole = !/^[\p{L}\p{N}]/u.test(name.slice(word.length));
  return said && whole ? undefined : word;
}

function asThing<P extends Thing>(place: P): Thing {
  return place;
}

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
  [LINK_PLACE.AGENT]: (place) => ({ kind: THING_KIND.AGENT, agentId: place.agentId }),
  [LINK_PLACE.PERSON]: (place) => ({ kind: THING_KIND.PERSON, userId: place.userId }),
  [LINK_PLACE.COMMENT]: asThing,
  [LINK_PLACE.VERSION]: asThing,
  [LINK_PLACE.WORKER]: asThing,
  [LINK_PLACE.CHANGES]: asThing,
  [LINK_PLACE.PULL_REQUEST_THREAD]: asThing,
  [LINK_PLACE.MESSAGE]: asThing,
  [LINK_PLACE.HOME]: asThing,
  [LINK_PLACE.BOARD]: asThing,
  [LINK_PLACE.INBOX]: asThing,
  [LINK_PLACE.INBOX_ITEM]: asThing,
  [LINK_PLACE.AUTOMATIONS]: asThing,
  [LINK_PLACE.AUTOMATION]: asThing,
  [LINK_PLACE.AUTOMATION_RUN]: asThing,
  [LINK_PLACE.SETTINGS]: asThing,
  [LINK_PLACE.ADMIN]: asThing,
};

function placeThing<K extends LinkPlaceKind>(kind: K, place: PlaceOf<K>): Thing {
  return PLACE_THING[kind](place);
}

function nameOf<K extends ThingKind>(
  kind: K,
  thing: ThingOf<K>,
  known: KnownNames,
  said: ThingSaid,
): ThingNameHeld {
  const { live, held } = THING_NAME[kind];
  return { live, held: held(thing, known, said) };
}

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

export function thingOfPlace(place: LinkPlace): Thing {
  return placeThing(place.kind, place);
}

export function thingName(thing: Thing, known: KnownNames, said: ThingSaid): ThingNameHeld {
  return nameOf(thing.kind, thing, known, said);
}

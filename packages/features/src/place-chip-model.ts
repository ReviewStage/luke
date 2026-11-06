import { LINK_PLACE, type LinkPlace } from "./link-grammar.js";
import { UNTITLED_TASK_NAME } from "./task-wire.js";
import { NOTHING_SAID, thingName, thingOfPlace } from "./thing-kind.js";

export interface KnownNames {
  readonly tasks: ReadonlyMap<string, string>;
  readonly agents: ReadonlyMap<string, string>;
  readonly agentModels: ReadonlyMap<string, string>;
  readonly pages: ReadonlyMap<string, string>;
  readonly pagesTaskId: string | undefined;
  readonly inboxItems: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, string>;
  readonly automations: ReadonlyMap<string, string>;
}

export interface PlaceChipLook {
  readonly name: string;
  readonly under: string | undefined;
}

const KIND_NAME = {
  [LINK_PLACE.TASK]: "Task",
  [LINK_PLACE.SECTION]: "Section",
  [LINK_PLACE.COMMENT]: "Comment",
  [LINK_PLACE.HOME]: "Home",
  [LINK_PLACE.BOARD]: "Tasks",
  [LINK_PLACE.VERSION]: "Version",
  [LINK_PLACE.PAGE]: "Page",
  [LINK_PLACE.AGENT]: "Agent",
  [LINK_PLACE.WORKER]: "Worker",
  [LINK_PLACE.CHANGES]: "Changes",
  [LINK_PLACE.PULL_REQUEST_THREAD]: "Review comment",
  [LINK_PLACE.MESSAGE]: "Message",
  [LINK_PLACE.INBOX]: "Inbox",
  [LINK_PLACE.INBOX_ITEM]: "Inbox item",
  [LINK_PLACE.AUTOMATIONS]: "Automations",
  [LINK_PLACE.AUTOMATION]: "Automation",
  [LINK_PLACE.AUTOMATION_RUN]: "Run",
  [LINK_PLACE.SETTINGS]: "Settings",
  [LINK_PLACE.PERSON]: "Profile",
  [LINK_PLACE.ADMIN]: "Admin",
} as const satisfies Record<LinkPlace["kind"], string>;

function taskOf(place: LinkPlace): string | undefined {
  if (place.kind === LINK_PLACE.TASK || place.kind === LINK_PLACE.VERSION) return undefined;
  return "planId" in place ? place.planId : undefined;
}

export function placeChipLook(
  place: LinkPlace,
  label: string | undefined,
  known: KnownNames,
): PlaceChipLook {
  const taskId = taskOf(place);
  const under = taskId === undefined ? undefined : known.tasks.get(taskId);
  const named = thingName(thingOfPlace(place), known, NOTHING_SAID);
  const held = named.held;
  const untitled = place.kind === LINK_PLACE.TASK && held === UNTITLED_TASK_NAME;
  const live = named.live && !untitled;
  const name = (live ? (held ?? label) : (label ?? held)) ?? KIND_NAME[place.kind];
  return { name, under };
}

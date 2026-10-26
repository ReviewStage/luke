import { LINK_PLACE, type LinkPlace } from "./link-grammar.js";
import { UNTITLED_TASK_NAME } from "./task-wire.js";
import { NOTHING_SAID, thingName, thingOfPlace } from "./thing-kind.js";

/**
 * place-chip-model.ts -- a Luke link drawn in words as its chip says it: the name of the place it opens, as the window already knows it, and the task it stands under.
 *
 * A link to a place in Luke an agent or a teammate writes bare, an agent's
 * or a page's address say, is drawn as a chip (the desktop's `mention-chip.tsx`), and the
 * chip is named from what the window already holds: the task's title, the
 * page's, the agent's, the Inbox item's, the member's, the automation's.
 * Nothing is read for it, so a place the window holds no name for, an agent
 * past the few a task's row names say, is called by its kind until it does.
 * A plan, a page, an agent, an Inbox item, or a person is called by the name
 * the window holds for it now even where its link was labelled, since the
 * label is the name it had when it was written and the card beside the chip
 * says the name now; the label stands in only where the window holds none,
 * or holds the plan Untitled. Any other place someone labelled keeps the
 * words they gave it. The card under it says the task the place stands
 * under, where the window knows the task.
 */

/** The names the window holds, each by the id the service minted it under. */
export interface KnownNames {
  readonly tasks: ReadonlyMap<string, string>;
  readonly agents: ReadonlyMap<string, string>;
  /** The catalog id of the model each agent the window holds runs on, which its harness's mark is read off; titled or not. */
  readonly agentModels: ReadonlyMap<string, string>;
  /** The pages of the one task the window holds them for, `pagesTaskId`. */
  readonly pages: ReadonlyMap<string, string>;
  /** The task whose pages `pages` names, the window's open one; none where it holds no task's pages. */
  readonly pagesTaskId: string | undefined;
  readonly inboxItems: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, string>;
  readonly automations: ReadonlyMap<string, string>;
}

/** What a chip says of a place: its name, and the task it stands under where that is known and is not the place itself. */
export interface PlaceChipLook {
  readonly name: string;
  readonly under: string | undefined;
}

/** What a place is called where the window holds no name for it. */
const KIND_NAME = {
  [LINK_PLACE.TASK]: "Task",
  [LINK_PLACE.SECTION]: "Section",
  [LINK_PLACE.COMMENT]: "Comment",
  [LINK_PLACE.VERSION]: "Version",
  [LINK_PLACE.PAGE]: "Page",
  [LINK_PLACE.TURN]: "Luke's work",
  [LINK_PLACE.AGENT]: "Agent",
  [LINK_PLACE.WORKER]: "Worker",
  [LINK_PLACE.CHANGES]: "Changes",
  [LINK_PLACE.PULL_REQUEST_THREAD]: "Review comment",
  [LINK_PLACE.MESSAGE]: "Message",
  [LINK_PLACE.INBOX]: "Inbox",
  [LINK_PLACE.INBOX_ITEM]: "Inbox item",
  [LINK_PLACE.CHANNEL]: "Channel",
  [LINK_PLACE.AUTOMATIONS]: "Automations",
  [LINK_PLACE.AUTOMATION]: "Automation",
  [LINK_PLACE.AUTOMATION_RUN]: "Run",
  [LINK_PLACE.SETTINGS]: "Settings",
  [LINK_PLACE.PERSON]: "Profile",
  [LINK_PLACE.ADMIN]: "Admin",
} as const satisfies Record<LinkPlace["kind"], string>;

/** The task a place stands under, by its id, where it stands under one and is not the task itself. */
function taskOf(place: LinkPlace): string | undefined {
  if (place.kind === LINK_PLACE.TASK || place.kind === LINK_PLACE.VERSION) return undefined;
  return "planId" in place ? place.planId : undefined;
}

/**
 * What a chip says of the place a Luke link opens: for a thing named live
 * (`THING_NAME`), the name the window holds for it, else the words it was
 * labelled with; for any other, the words first, then the name held; else
 * its kind; and the task it stands under, by the name the window holds for it.
 */
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

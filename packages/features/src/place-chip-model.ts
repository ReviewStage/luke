import { LINK_PLACE, type LinkPlace } from "./luke-link.js";

/**
 * place-chip-model.ts -- a Luke link drawn in words as its chip says it: the name of the place it opens, as the window already knows it, and the task it stands under.
 *
 * A link to a place in Luke an agent or a teammate writes bare, an agent's
 * or a page's address say, is drawn as a chip (the desktop's `mention-chip.tsx`), and the
 * chip is named from what the window already holds: the task's title, the
 * page's, the agent's, the Inbox item's, the member's, the automation's.
 * Nothing is read for it, so a place the window holds no name for, an agent
 * past the few a task's row names say, is called by its kind until it does,
 * and a link someone labelled keeps the words they gave it, as a mention's
 * label is kept. The card under it says the task the place stands under,
 * where the window knows the task.
 */

/** The names the window holds, each by the id the service minted it under. */
export interface KnownNames {
  readonly plans: ReadonlyMap<string, string>;
  readonly agents: ReadonlyMap<string, string>;
  readonly pages: ReadonlyMap<string, string>;
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
  [LINK_PLACE.VERSION]: "Version",
  [LINK_PLACE.PAGE]: "Page",
  [LINK_PLACE.CALL]: "Call",
  [LINK_PLACE.TURN]: "Luke's work",
  [LINK_PLACE.AGENT]: "Agent",
  [LINK_PLACE.WORKER]: "Worker",
  [LINK_PLACE.CHANGES]: "Changes",
  [LINK_PLACE.MESSAGE]: "Message",
  [LINK_PLACE.INBOX]: "Inbox",
  [LINK_PLACE.INBOX_ITEM]: "Inbox item",
  [LINK_PLACE.AUTOMATIONS]: "Automations",
  [LINK_PLACE.AUTOMATION]: "Automation",
  [LINK_PLACE.AUTOMATION_RUN]: "Run",
  [LINK_PLACE.FACTORY]: "Factory",
  [LINK_PLACE.SETTINGS]: "Settings",
  [LINK_PLACE.PERSON]: "Profile",
} as const satisfies Record<LinkPlace["kind"], string>;

/** The name the window holds for the place itself, where it holds one. */
function heldName(place: LinkPlace, known: KnownNames): string | undefined {
  switch (place.kind) {
    case LINK_PLACE.TASK:
      return known.plans.get(place.planId);
    case LINK_PLACE.VERSION: {
      const plan = known.plans.get(place.planId);
      return plan === undefined ? undefined : `${plan}, version ${place.revision}`;
    }
    case LINK_PLACE.PAGE:
      return known.pages.get(place.pageId);
    case LINK_PLACE.AGENT:
      return known.agents.get(place.agentId);
    case LINK_PLACE.CHANGES: {
      const agent = known.agents.get(place.agentId);
      return agent === undefined ? undefined : `Changes by ${agent}`;
    }
    case LINK_PLACE.MESSAGE: {
      const agent = known.agents.get(place.agentId);
      return agent === undefined ? undefined : `Message from ${agent}`;
    }
    case LINK_PLACE.INBOX_ITEM:
      return known.inboxItems.get(place.itemId);
    case LINK_PLACE.AUTOMATION:
    case LINK_PLACE.AUTOMATION_RUN:
      return known.automations.get(place.automationId);
    case LINK_PLACE.PERSON:
      return known.people.get(place.userId);
    default:
      return undefined;
  }
}

/** The task a place stands under, by its id, where it stands under one and is not the task itself. */
function taskOf(place: LinkPlace): string | undefined {
  if (place.kind === LINK_PLACE.TASK || place.kind === LINK_PLACE.VERSION) return undefined;
  return "planId" in place ? place.planId : undefined;
}

/**
 * What a chip says of the place a Luke link opens: the words it was labelled
 * with where it was, else the name the window holds for the place, else its
 * kind; and the task it stands under, by the name the window holds for it.
 */
export function placeChipLook(
  place: LinkPlace,
  label: string | undefined,
  known: KnownNames,
): PlaceChipLook {
  const planId = taskOf(place);
  const under = planId === undefined ? undefined : known.plans.get(planId);
  const name = label ?? heldName(place, known) ?? KIND_NAME[place.kind];
  return { name, under };
}

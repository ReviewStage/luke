import type { KnownNames } from "@luke/features/place-chip-model";
import { useMemo } from "react";
import { useAutomation } from "../automation-directory";
import { useMemberDirectory } from "../member-directory";
import { useAppState } from "../use-app-state";

/**
 * use-known-names.ts -- the names the window already holds for places in Luke, by id, for a chip to call a Luke link by.
 *
 * Read from main's document, which every window holds: every task's title,
 * the agents each task's row names, the active task's pages, the Inbox
 * items waiting, and the agents an automation started with no task; and
 * from the directories standing around the caller, the members and the
 * automation asked for. Nothing is fetched, so a name the window does not
 * hold is not here.
 */

const NONE: ReadonlyMap<string, string> = new Map();

/** The names the window holds, the automation `automationId` names among them where the directory around the caller lists it. */
export function useKnownNames(automationId?: string): KnownNames {
  const state = useAppState();
  const { members, former } = useMemberDirectory();
  const automation = useAutomation(automationId)?.automation;
  const planning = state?.planning;
  const inbox = state?.inbox;
  const held = useMemo(() => {
    const plans = new Map(planning?.plans.map((plan) => [plan.id, plan.name]));
    const agents = new Map<string, string>();
    for (const plan of planning?.plans ?? []) {
      for (const agent of plan.agents?.agents ?? []) {
        if (agent.title !== null) agents.set(agent.id, agent.title);
      }
    }
    for (const item of inbox?.planless ?? []) {
      if (item.agentTitle !== null) agents.set(item.agentId, item.agentTitle);
    }
    const pages = new Map(planning?.pages?.map((page) => [page.id, page.title]));
    const inboxItems = new Map(
      [...(inbox?.waiting ?? []).flatMap((plan) => plan.items), ...(inbox?.planless ?? [])].map(
        (item) => [item.id, item.title],
      ),
    );
    return { plans, agents, pages, inboxItems };
  }, [planning, inbox]);
  const people = useMemo(
    () => new Map([...(former ?? []), ...(members ?? [])].map((each) => [each.userId, each.name])),
    [members, former],
  );
  const automations = useMemo(
    () => (automation === undefined ? NONE : new Map([[automation.id, automation.name]])),
    [automation],
  );
  return useMemo(() => ({ ...held, people, automations }), [held, people, automations]);
}

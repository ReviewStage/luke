import { createContext, type ReactNode, useContext } from "react";
import type { MentionDoors } from "./mention-chip";

/**
 * plan-mentions.tsx -- what a plan's page hands every place on it that picks or draws a mention: the plan, its saved text, and what opening a mention does.
 *
 * The plan's own words draw their mentions through the document
 * (`plan-body.tsx`); an agent's message box on the same page picks them with
 * `@` (`agent-composer.tsx`), and its transcript draws the ones a message
 * holds as chips (`transcript-blocks.tsx`). Those stand far from the plan's
 * page in the tree, so the page hands them this, as it hands them its skills
 * (`skill-chip.tsx`'s `SkillFiles`). A place off a plan's page reads nothing,
 * picks no mention, and draws a mention's link as words.
 */

/** A plan's page's mentions: the plan, its text as saved, and the doors its chips open through. */
export interface PlanMentionsValue {
  readonly planId: string;
  readonly planName: string;
  /** The plan's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  readonly text: () => string;
  readonly doors: MentionDoors;
}

const PlanMentionsContext = createContext<PlanMentionsValue | undefined>(undefined);

/**
 * Hands every place under it the plan's page's mentions. Note that the text
 * is the plan's saved words, never an open editor's, because the agent is
 * handed the sections of the plan as saved, and a section the box offered
 * that the send cannot find would reach the agent as gone.
 */
export function PlanMentions({
  value,
  children,
}: {
  value: PlanMentionsValue;
  children: ReactNode;
}): React.JSX.Element {
  return <PlanMentionsContext.Provider value={value}>{children}</PlanMentionsContext.Provider>;
}

/** The plan's page's mentions; nothing off a plan's page. */
export function usePlanMentions(): PlanMentionsValue | undefined {
  return useContext(PlanMentionsContext);
}

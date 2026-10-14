import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react";
import type { MentionDoors } from "./mention-chip";

/**
 * plan-mentions.tsx -- what a plan's page hands every place on it that picks or draws a mention: the plan, its text as it stands, and what opening a mention does.
 *
 * The plan's own words draw their mentions through the document
 * (`plan-body.tsx`); an agent's message box on the same page picks them with
 * `@` (`agent-composer.tsx`), and its transcript draws the ones a message
 * holds as chips (`transcript-blocks.tsx`). Those stand far from the plan's
 * page in the tree, so the page hands them this, as it hands them its skills
 * (`skill-chip.tsx`'s `SkillFiles`). A place off a plan's page reads nothing,
 * picks no mention, and draws a mention's link as words.
 */

/** A plan's page's mentions: the plan, its text as it stands now, and the doors its chips open through. */
export interface PlanMentionsValue {
  readonly planId: string;
  readonly planName: string;
  /** The plan's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  readonly text: () => string;
  readonly doors: MentionDoors;
}

/** The page's mentions as places under it read them, and where the plan's open editor lends its text. */
interface PlanMentionsPage extends PlanMentionsValue {
  readonly lent: RefObject<(() => string) | undefined>;
}

const PlanMentionsContext = createContext<PlanMentionsPage | undefined>(undefined);

/**
 * Hands every place under it the plan's page's mentions. Note that the text
 * is the open editor's where one stands, because its words are saved only
 * once typing pauses, and a section just written is one to mention.
 */
export function PlanMentions({
  value,
  children,
}: {
  value: PlanMentionsValue;
  children: ReactNode;
}): React.JSX.Element {
  const lent = useRef<(() => string) | undefined>(undefined);
  const page: PlanMentionsPage = { ...value, text: () => lent.current?.() ?? value.text(), lent };
  return <PlanMentionsContext.Provider value={page}>{children}</PlanMentionsContext.Provider>;
}

/** The plan's page's mentions; nothing off a plan's page. */
export function usePlanMentions(): PlanMentionsValue | undefined {
  return useContext(PlanMentionsContext);
}

/** Lends the page the plan's open editor's text, read before the plan's saved words for as long as the editor stands. */
export function useLentPlanText(read: () => string): void {
  const lent = useContext(PlanMentionsContext)?.lent;
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    if (lent === undefined) return;
    const lending = () => latest.current();
    lent.current = lending;
    return () => {
      if (lent.current === lending) lent.current = undefined;
    };
  }, [lent]);
}

import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react";
import type { MentionNode } from "../plan-editor/contract";
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
 *
 * The page also carries a mention made elsewhere on it into the agent's
 * message box drawn there: the box drawn now takes it in (`useMentionBox`),
 * and a File tab's ⌥K hands it the lines picked (`useMentionDrop`). The
 * page draws one agent's tab at a time, so the box drawn is the current
 * agent's.
 */

/** A plan's page's mentions: the plan, its text as saved, and the doors its chips open through. */
export interface PlanMentionsValue {
  readonly planId: string;
  readonly planName: string;
  /** The slug of the plan's workspace, which a mention of it is written under. */
  readonly workspace: string;
  /** The plan's repository, `owner/name`; null before one is chosen. */
  readonly repository: string | null;
  readonly text: () => string;
  readonly doors: MentionDoors;
}

const PlanMentionsContext = createContext<PlanMentionsValue | undefined>(undefined);

/** What takes in a mention made elsewhere on the page: the agent's message box drawn there. */
type MentionBox = (mention: MentionNode) => void;

const MentionBoxContext = createContext<RefObject<MentionBox | undefined> | undefined>(undefined);

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
  const box = useRef<MentionBox | undefined>(undefined);
  return (
    <PlanMentionsContext.Provider value={value}>
      <MentionBoxContext.Provider value={box}>{children}</MentionBoxContext.Provider>
    </PlanMentionsContext.Provider>
  );
}

/** The plan's page's mentions; nothing off a plan's page. */
export function usePlanMentions(): PlanMentionsValue | undefined {
  return useContext(PlanMentionsContext);
}

/** Makes the agent's message box the one a mention made elsewhere on the page is laid into, for as long as it is drawn. */
export function useMentionBox(receive: MentionBox): void {
  const box = useContext(MentionBoxContext);
  const latest = useRef(receive);
  latest.current = receive;
  useEffect(() => {
    if (box === undefined) return;
    const taking: MentionBox = (mention) => latest.current(mention);
    box.current = taking;
    return () => {
      if (box.current === taking) box.current = undefined;
    };
  }, [box]);
}

/** Hands a mention to the agent's message box drawn on the page, answering whether one took it; nothing off a plan's page. */
export function useMentionDrop(): ((mention: MentionNode) => boolean) | undefined {
  const box = useContext(MentionBoxContext);
  if (box === undefined) return undefined;
  return (mention) => {
    const receive = box.current;
    if (receive === undefined) return false;
    receive(mention);
    return true;
  };
}

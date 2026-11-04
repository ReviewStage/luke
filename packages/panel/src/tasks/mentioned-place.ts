import type { CatalogModel } from "@repo/features/models-wire";
import { createContext, useContext } from "react";

/**
 * mentioned-place.ts -- what the window around a chip names its agents by: the catalog that names their models, and the reader.
 *
 * It stands apart from the cards that read it (`mentioned-agent-card.tsx`)
 * so the names every chip is called by (`use-known-names.ts`) read the same
 * catalog an agent's tab and row are named by, without the card's module.
 */

/** What a mentioned agent's chip and card name it by: the catalog that names its model, and the reader, whose own agents name no starter. */
export interface MentionedAgentsPlace {
  readonly models: readonly CatalogModel[] | undefined;
  readonly me: string | undefined;
}

const NO_PLACE: MentionedAgentsPlace = { models: undefined, me: undefined };

const MentionedAgentsContext = createContext<MentionedAgentsPlace>(NO_PLACE);

/** Hands every agent's chip under it what it is named by. */
export const MentionedAgents = MentionedAgentsContext.Provider;

/** The reader, as the window around the chips names them, whose own work a card names no one over. */
export function useMentionedReader(): string | undefined {
  return useContext(MentionedAgentsContext).me;
}

/** What the window around the chips names an agent by: the catalog that names its model, and the reader. */
export function useMentionedPlace(): MentionedAgentsPlace {
  return useContext(MentionedAgentsContext);
}

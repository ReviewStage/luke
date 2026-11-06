import type { CatalogModel } from "@repo/features/models-wire";
import { createContext, useContext } from "react";

export interface MentionedAgentsPlace {
  readonly models: readonly CatalogModel[] | undefined;
  readonly me: string | undefined;
}

const NO_PLACE: MentionedAgentsPlace = { models: undefined, me: undefined };

const MentionedAgentsContext = createContext<MentionedAgentsPlace>(NO_PLACE);

export const MentionedAgents = MentionedAgentsContext.Provider;

export function useMentionedReader(): string | undefined {
  return useContext(MentionedAgentsContext).me;
}

export function useMentionedPlace(): MentionedAgentsPlace {
  return useContext(MentionedAgentsContext);
}

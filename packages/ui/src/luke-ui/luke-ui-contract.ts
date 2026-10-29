import type { ComponentType, ReactNode } from "react";

/**
 * luke-ui-contract.ts -- what a transcript and the bundle that draws a ```` ```luke-ui ```` fence say to each other: the fence's language, and the one component the bundle exports.
 *
 * json-render and zod are too large for the bundle every window parses, so
 * the spec's renderer (`luke-ui-spec.tsx`) ships as a bundle of its own that
 * the panel imports the first time a transcript shows a whole fence in this
 * language, as a plan's diagram bundle is (`diagram-contract.ts`). Nothing
 * here imports a value, so the transcript carries none of either.
 */

/** The language a fence an agent draws as components is written in. */
export const LUKE_UI_LANGUAGE = "luke-ui";

/** The components a spec may name, as a model writes them (`luke-ui-catalog.ts`). */
export const LUKE_UI_COMPONENT = {
  CARD: "Card",
  FACTS: "Facts",
  TABLE: "Table",
  BADGE: "Badge",
  LIST: "List",
  TEXT: "Text",
} as const;

/** What the bundle's entry exports, which the panel imports the first time a fence is drawn. */
export interface LukeUiModule {
  /** A fence's code drawn as the components its spec names, or `fallback` where the spec cannot be read; never a throw. */
  readonly LukeUiSpec: ComponentType<{ code: string; fallback: ReactNode }>;
}

import { MODEL_PROVIDER } from "@luke/features/models-wire";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * harness-mark.tsx -- the mark of the harness a coding agent's model runs in: a sparkle for Claude on Anthropic's models, Codex's own cloud for OpenAI's.
 *
 * Claude's is a glyph of ours, not Anthropic's artwork, since Anthropic's
 * Agent SDK terms rule out visual elements that mimic Claude Code; it draws
 * in our stroke and inherits `currentColor` like any other glyph. Codex's is
 * OpenAI's picture, drawn from the files the app serves (`CodexArt`). Either
 * fills the glyph cell of the row, tab, or chip it leads, which sizes it.
 */

/** Codex's picture, as the addresses the app serves it at one, two, and three device pixels to the pixel. */
export interface CodexArt {
  readonly oneX: string;
  readonly twoX: string;
  readonly threeX: string;
}

/** A harness's mark: Codex's needs its picture's addresses, Claude's none. */
export type HarnessMarkProps =
  | { readonly provider: typeof MODEL_PROVIDER.ANTHROPIC; readonly codexArt?: CodexArt }
  | { readonly provider: typeof MODEL_PROVIDER.OPENAI; readonly codexArt: CodexArt };

/** The mark of the harness a provider's models run in, for the rows, tabs, and chips that name an agent or a model. */
export function HarnessMark({ provider, codexArt }: HarnessMarkProps): React.JSX.Element {
  if (provider === MODEL_PROVIDER.OPENAI && codexArt !== undefined) {
    return (
      <img
        className="luke-harness-mark"
        data-provider={provider}
        src={codexArt.oneX}
        srcSet={`${codexArt.oneX} 1x, ${codexArt.twoX} 2x, ${codexArt.threeX} 3x`}
        alt=""
        draggable={false}
      />
    );
  }
  // A four-pointed sparkle: Lucide's `sparkle` (https://lucide.dev, ISC
  // licence, copyright (c) Lucide Contributors 2022), drawn in our stroke.
  return (
    <svg
      className="luke-harness-mark"
      data-provider={provider}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
    </svg>
  );
}

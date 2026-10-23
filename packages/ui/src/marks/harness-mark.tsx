import { MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * harness-mark.tsx -- the mark of the harness a coding agent's model runs in: a sparkle for Claude on Anthropic's models, a terminal's prompt for Codex on OpenAI's.
 *
 * Glyphs of ours, not either vendor's artwork: Luke has no right to
 * redistribute the art in Anthropic's or OpenAI's own extensions, and
 * Anthropic's Agent SDK terms rule out visual elements that mimic Claude
 * Code. Each draws in our stroke and inherits `currentColor` like any other
 * glyph, at the glyph cell of the row, tab, or chip it leads, which sizes
 * it; the name beside it, or the caller's label, is what a reader hears.
 */

/** What each harness draws inside its 24-unit box. */
function harnessBody(provider: ModelProvider): React.JSX.Element {
  switch (provider) {
    // A four-pointed sparkle: Lucide's `sparkle` (https://lucide.dev, ISC
    // licence, copyright (c) Lucide Contributors 2022), drawn in our stroke.
    case MODEL_PROVIDER.ANTHROPIC:
      return (
        <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      );
    // A terminal's prompt, as `TerminalIcon` draws the Settings page about these agents.
    case MODEL_PROVIDER.OPENAI:
      return (
        <>
          <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.4" />
          <path d="m7 9.2 3.2 2.8L7 14.8" />
          <path d="M12.6 14.8h4.2" />
        </>
      );
  }
}

/** The mark of the harness a provider's models run in, for the rows, tabs, and chips that name an agent or a model. */
export function HarnessMark({ provider }: { provider: ModelProvider }): React.JSX.Element {
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
      {harnessBody(provider)}
    </svg>
  );
}

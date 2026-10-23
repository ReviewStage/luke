import { MODEL_PROVIDER } from "@luke/features/models-wire";
import React from "react";

// `tsx` executes imported workspace-package JSX with the classic runtime.
void React;

/**
 * harness-mark.tsx -- the mark of the harness a coding agent's model runs in: Claude Code's Clawd for Anthropic's models, Codex's own cloud for OpenAI's.
 *
 * Claude Code's Clawd, verbatim from `resources/clawd.svg` in Anthropic's own
 * Claude Code extension for VS Code (publisher Anthropic, version 2.1.296),
 * in its own clay. Anthropic's press kit carries the Claude Code wordmark
 * but no mark of Clawd alone. Codex's is OpenAI's picture, drawn from the
 * files the app serves (`CodexArt`). Either fills the glyph cell of the row,
 * tab, or chip it leads, which sizes it.
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
  return (
    <svg
      className="luke-harness-mark"
      data-provider={provider}
      viewBox="0 0 47 38"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#D97757"
        d="M5.08191 10.0769V0.938461H9.37422V10.0769H5.08191ZM9.23305 10.0769V0.938461H13.5254V10.0769H9.23305ZM13.3842 10.0769V0.938461H17.6765V10.0769H13.3842ZM17.5353 10.0769V0.938461H21.8276V10.0769H17.5353ZM21.6865 10.0769V0.938461H25.9788V10.0769H21.6865ZM25.8376 10.0769V0.938461H30.1299V10.0769H25.8376ZM29.9888 10.0769V0.938461H34.2811V10.0769H29.9888ZM34.1399 10.0769V0.938461H38.4322V10.0769H34.1399ZM38.291 10.0769V0.938461H42.5834V10.0769H38.291ZM0.930769 19.0769V9.93846H5.22308V19.0769H0.930769ZM5.08191 19.0769V9.93846H9.37422V19.0769H5.08191ZM9.23305 19.0769V14.5077H13.5254V19.0769H9.23305ZM13.3842 19.0769V9.93846H17.6765V19.0769H13.3842ZM17.5353 19.0769V9.93846H21.8276V19.0769H17.5353ZM21.6865 19.0769V9.93846H25.9788V19.0769H21.6865ZM25.8376 19.0769V9.93846H30.1299V19.0769H25.8376ZM29.9888 19.0769V9.93846H34.2811V19.0769H29.9888ZM34.1399 19.0769V14.5077H38.4322V19.0769H34.1399ZM38.291 19.0769V9.93846H42.5834V19.0769H38.291ZM42.4422 19.0769V9.93846H46.7345V19.0769H42.4422ZM5.08191 28.0769V18.9385H9.37422V28.0769H5.08191ZM9.23305 28.0769V18.9385H13.5254V28.0769H9.23305ZM13.3842 28.0769V18.9385H17.6765V28.0769H13.3842ZM17.5353 28.0769V18.9385H21.8276V28.0769H17.5353ZM21.6865 28.0769V18.9385H25.9788V28.0769H21.6865ZM25.8376 28.0769V18.9385H30.1299V28.0769H25.8376ZM29.9888 28.0769V18.9385H34.2811V28.0769H29.9888ZM34.1399 28.0769V18.9385H38.4322V28.0769H34.1399ZM38.291 28.0769V18.9385H42.5834V28.0769H38.291ZM5.08191 37.0769V27.9385H9.37422V37.0769H5.08191ZM13.3842 37.0769V27.9385H17.6765V37.0769H13.3842ZM29.9888 37.0769V27.9385H34.2811V37.0769H29.9888ZM38.291 37.0769V27.9385H42.5834V37.0769H38.291Z"
      />
    </svg>
  );
}

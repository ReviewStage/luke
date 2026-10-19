import { MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import { assetUrl } from "./app-platform.js";

/**
 * harness-marks.tsx -- the marks of the two harnesses a coding agent's model runs in: Claude Code for Anthropic's models, Codex for OpenAI's.
 *
 * Brand marks like the account and integration providers' in `@luke/ui`'s
 * `ProviderMark`, not glyphs of ours, each the harness's own artwork at its
 * own proportions and in its own colours, which read on a light ground and a
 * dark one alike. They stay in the desktop, the one app that draws a harness,
 * where the provider marks are shared because the site draws them too.
 */

/** The Codex mark's files under the shell's asset base, where the desktop's build copies them beside `panel.js` (`scripts/build.mjs`). */
const CODEX_MARK_FILES = {
  ONE_X: "marks/codex-16.png",
  TWO_X: "marks/codex-32.png",
  THREE_X: "marks/codex-48.png",
} as const;

/**
 * Claude Code's Clawd, verbatim from `resources/clawd.svg` in Anthropic's own
 * Claude Code extension for VS Code (publisher Anthropic, version 2.1.296),
 * in its own clay. Anthropic's press kit carries the Claude Code wordmark
 * but no mark of Clawd alone.
 */
function ClaudeCodeMark(): React.JSX.Element {
  return (
    <svg className="harness-mark" viewBox="0 0 47 38" aria-hidden="true" focusable="false">
      <path
        fill="#D97757"
        d="M5.08191 10.0769V0.938461H9.37422V10.0769H5.08191ZM9.23305 10.0769V0.938461H13.5254V10.0769H9.23305ZM13.3842 10.0769V0.938461H17.6765V10.0769H13.3842ZM17.5353 10.0769V0.938461H21.8276V10.0769H17.5353ZM21.6865 10.0769V0.938461H25.9788V10.0769H21.6865ZM25.8376 10.0769V0.938461H30.1299V10.0769H25.8376ZM29.9888 10.0769V0.938461H34.2811V10.0769H29.9888ZM34.1399 10.0769V0.938461H38.4322V10.0769H34.1399ZM38.291 10.0769V0.938461H42.5834V10.0769H38.291ZM0.930769 19.0769V9.93846H5.22308V19.0769H0.930769ZM5.08191 19.0769V9.93846H9.37422V19.0769H5.08191ZM9.23305 19.0769V14.5077H13.5254V19.0769H9.23305ZM13.3842 19.0769V9.93846H17.6765V19.0769H13.3842ZM17.5353 19.0769V9.93846H21.8276V19.0769H17.5353ZM21.6865 19.0769V9.93846H25.9788V19.0769H21.6865ZM25.8376 19.0769V9.93846H30.1299V19.0769H25.8376ZM29.9888 19.0769V9.93846H34.2811V19.0769H29.9888ZM34.1399 19.0769V14.5077H38.4322V19.0769H34.1399ZM38.291 19.0769V9.93846H42.5834V19.0769H38.291ZM42.4422 19.0769V9.93846H46.7345V19.0769H42.4422ZM5.08191 28.0769V18.9385H9.37422V28.0769H5.08191ZM9.23305 28.0769V18.9385H13.5254V28.0769H9.23305ZM13.3842 28.0769V18.9385H17.6765V28.0769H13.3842ZM17.5353 28.0769V18.9385H21.8276V28.0769H17.5353ZM21.6865 28.0769V18.9385H25.9788V28.0769H21.6865ZM25.8376 28.0769V18.9385H30.1299V28.0769H25.8376ZM29.9888 28.0769V18.9385H34.2811V28.0769H29.9888ZM34.1399 28.0769V18.9385H38.4322V28.0769H34.1399ZM38.291 28.0769V18.9385H42.5834V28.0769H38.291ZM5.08191 37.0769V27.9385H9.37422V37.0769H5.08191ZM13.3842 37.0769V27.9385H17.6765V37.0769H13.3842ZM29.9888 37.0769V27.9385H34.2811V37.0769H29.9888ZM38.291 37.0769V27.9385H42.5834V37.0769H38.291Z"
      />
    </svg>
  );
}

/**
 * Codex's cloud, which OpenAI publishes in no vector form: the art is
 * `webview/assets/codex-app-ga-logo-3e5209898ca3.png` (104 by 104) in
 * OpenAI's own Codex extension for VS Code (publisher openai, version
 * 26.51007.21434), scaled down whole to the 16-pixel box a mark is drawn
 * in at one, two, and three device pixels to the pixel, and losslessly
 * recompressed (the panel's `marks/`). Files beside the bundle rather than inlined, so
 * the renderer bundle carries none of their bytes.
 */
function CodexMark(): React.JSX.Element {
  const oneX = assetUrl(CODEX_MARK_FILES.ONE_X);
  return (
    <img
      className="harness-mark"
      src={oneX}
      srcSet={`${oneX} 1x, ${assetUrl(CODEX_MARK_FILES.TWO_X)} 2x, ${assetUrl(CODEX_MARK_FILES.THREE_X)} 3x`}
      width={16}
      height={16}
      alt=""
      draggable={false}
    />
  );
}

/** The mark of the harness a provider's models run in, for the rows that name a model by its catalog entry. */
export function HarnessMark({ provider }: { provider: ModelProvider }): React.JSX.Element {
  return provider === MODEL_PROVIDER.ANTHROPIC ? <ClaudeCodeMark /> : <CodexMark />;
}

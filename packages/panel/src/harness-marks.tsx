import { MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import { HarnessMark as Mark } from "@luke/ui";
import { assetUrl } from "./app-platform.js";

/**
 * harness-marks.tsx -- `@luke/ui`'s harness mark, Codex's drawn from its files under the shell's asset base.
 */

/** The Codex mark's files under the shell's asset base, where the desktop's build copies them beside `panel.js` (`scripts/build.mjs`). */
const CODEX_MARK_FILES = {
  ONE_X: "marks/codex-16.png",
  TWO_X: "marks/codex-32.png",
  THREE_X: "marks/codex-48.png",
} as const;

/** The mark of the harness a provider's models run in, for the rows that name a model by its catalog entry. */
export function HarnessMark({ provider }: { provider: ModelProvider }): React.JSX.Element {
  if (provider !== MODEL_PROVIDER.OPENAI) return <Mark provider={provider} />;
  const codexArt = {
    oneX: assetUrl(CODEX_MARK_FILES.ONE_X),
    twoX: assetUrl(CODEX_MARK_FILES.TWO_X),
    threeX: assetUrl(CODEX_MARK_FILES.THREE_X),
  };
  return <Mark provider={provider} codexArt={codexArt} />;
}

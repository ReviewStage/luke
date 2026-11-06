import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import { HarnessMark as Mark } from "@repo/ui";
import { assetUrl } from "./app-platform.js";

const CODEX_MARK_FILES = {
  ONE_X: "marks/codex-16.png",
  TWO_X: "marks/codex-32.png",
  THREE_X: "marks/codex-48.png",
} as const;

export function HarnessMark({ provider }: { provider: ModelProvider }): React.JSX.Element {
  if (provider !== MODEL_PROVIDER.OPENAI) return <Mark provider={provider} />;
  const codexArt = {
    oneX: assetUrl(CODEX_MARK_FILES.ONE_X),
    twoX: assetUrl(CODEX_MARK_FILES.TWO_X),
    threeX: assetUrl(CODEX_MARK_FILES.THREE_X),
  };
  return <Mark provider={provider} codexArt={codexArt} />;
}

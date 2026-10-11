import type { CatalogModel, ModelChoice } from "@sidecar/hosted/models-wire";
import { choiceWords } from "./coding-agent-model";

/**
 * model-label.tsx -- a model and its effort as every place draws the pair: "Opus 5.5 High", the effort dimmed after the name.
 *
 * The one way the panel draws a choice: the composer's model button, a
 * subagent's row, wherever a model and the effort it runs at stand
 * together. The name keeps the colour of the line it stands in and the
 * detail after it, the effort and Fast where the fast version is on, is
 * the muted secondary colour, so no mark and no separator sit between
 * them. A space, not a margin, parts the two, so the pair reads and copies
 * as one line.
 */
export function ModelLabel({
  choice,
  models,
}: {
  choice: ModelChoice;
  /** The catalog as last read, which names the model; empty before the first read lands. */
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const words = choiceWords(choice, models);
  return (
    <span className="model-label" data-model-label="">
      <span className="model-label-name">{words.model}</span>{" "}
      <span className="model-label-detail">{words.detail}</span>
    </span>
  );
}

import type { CatalogModel, ModelChoice } from "@luke/features/models-wire";
import { choiceWords } from "./coding-agent-model.js";

/**
 * model-label.tsx -- a model and its effort as every place draws the pair: "Opus 5.5 High", the effort dimmed after the name.
 *
 * The one way the panel draws a choice: the composer's model button, a
 * subagent's row, wherever a model and the effort it runs at stand
 * together. The name keeps the colour of the line it stands in and the
 * detail after it, the effort, Fast where the fast version is on, and the
 * standard context window's size where the choice runs on that rather than
 * the model's whole window ("GPT-5.5 High 272K"), is the muted secondary
 * colour, so no mark and no separator sit between
 * them. A space, not a margin, parts the two, so the pair reads and copies
 * as one line. A choice that says nothing after the name, as a turn's
 * recorded before its effort was, draws the name alone.
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
      <span className="model-label-name">{words.model}</span>
      {words.detail === "" ? null : (
        <>
          {" "}
          <span className="model-label-detail">{words.detail}</span>
        </>
      )}
    </span>
  );
}

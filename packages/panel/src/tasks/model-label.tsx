import type { CatalogModel, ModelChoice } from "@repo/features/models-wire";
import { choiceWords } from "./agent-model.js";

export function ModelLabel({
  choice,
  models,
}: {
  choice: ModelChoice;
  models: readonly CatalogModel[];
}): React.JSX.Element {
  const words = choiceWords(choice, models);
  return (
    <span className="model-label whitespace-nowrap" data-model-label="">
      <span className="model-label-name">{words.model}</span>
      {words.detail === "" ? null : (
        <>
          {" "}
          <span className="text-muted-foreground">{words.detail}</span>
        </>
      )}
    </span>
  );
}

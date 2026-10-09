import type { CatalogModel } from "@sidecar/hosted/models-wire";

/**
 * model-label.ts -- a model as a tab, a menu, or a notification names it: the catalog's own name, or the id's own name spelled out.
 *
 * Shared by the panel, which draws the tabs and the Start menu, and the main
 * process, which posts the notification an agent's end is announced in, so
 * the two never name one model two ways.
 */

/** The one separator a catalog id has between its provider and the model's own name. */
const CATALOG_ID_SEPARATOR = "/";

/** Words a model's own name is joined by, which its label spaces. */
const MODEL_NAME_SEPARATOR = "-";

/** The one model family whose name is an initialism, drawn in capitals. */
const GPT = "gpt";

/**
 * A model as a tab or a menu names it: the catalog's own name where the
 * catalog has been read, else the id's own name past its provider with its
 * words capitalised, so a tab never shows a bare id.
 */
export function modelLabel(modelId: string, models?: readonly CatalogModel[]): string {
  const listed = models?.find((model) => model.id === modelId);
  if (listed !== undefined) return listed.name;
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  const name = separator === -1 ? modelId : modelId.slice(separator + 1);
  return name
    .split(MODEL_NAME_SEPARATOR)
    .filter((word) => word.length > 0)
    .map((word) =>
      word === GPT ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}

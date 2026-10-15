import { type CatalogModel, MODEL_PROVIDER } from "./models-wire.js";

/**
 * model-label.ts -- a model as a tab, a menu, or a notification names it: the catalog's own name, or the id's own name spelled out; and an agent by its title, its automation, or its model.
 *
 * Shared by the panel, which draws the tabs and the Start menu, the main
 * process, which posts the notification an agent's end is announced in, and
 * the planning model's coding-agent tools, whose answers Luke says aloud, so
 * no two of them name one model two ways; and the service, which names
 * every model it records by the catalog's id before it sends one.
 */

/** The one separator a catalog id has between its provider and the model's own name. */
export const CATALOG_ID_SEPARATOR = "/";

/** Words a model's own name is joined by, which its label spaces. */
const MODEL_NAME_SEPARATOR = "-";

/** The one model family whose name is an initialism, drawn in capitals. */
const GPT = "gpt";

/**
 * The maker's word Anthropic's names lead with, which a label leaves off:
 * the harness mark beside a model already says whose it is, so "Claude Opus
 * 5.5" reads "Opus 5.5", and Luke says it the way the screen shows it. OpenAI's names carry no such word and stay whole.
 */
const MAKER_WORD = "Claude ";

/**
 * A recorded model as the catalog names it. Note that what Luke runs on its
 * own OpenAI key records OpenAI's own id where it names no catalog id: a
 * call's voice model (`gpt-live-1`), and the brain's turn rows written before
 * it named its model by the catalog's id. The catalog names those under their
 * provider, which is how a card reads whose mark the model wears; an id that
 * already names one is kept.
 */
export function catalogIdOf(model: string): string {
  return model.includes(CATALOG_ID_SEPARATOR)
    ? model
    : `${MODEL_PROVIDER.OPENAI}${CATALOG_ID_SEPARATOR}${model}`;
}

/** A name without the maker's word it leads with. */
function withoutMaker(name: string): string {
  return name.startsWith(MAKER_WORD) ? name.slice(MAKER_WORD.length) : name;
}

/**
 * A model as a tab or a menu names it: the catalog's own name where the
 * catalog has been read, else the id's own name past its provider with its
 * words capitalised, so a tab never shows a bare id; either way without the
 * maker's word it leads with. This is the one name a person reads for a
 * model; the id stays the catalog's.
 */
export function modelLabel(modelId: string, models?: readonly CatalogModel[]): string {
  const listed = models?.find((model) => model.id === modelId);
  if (listed !== undefined) return withoutMaker(listed.name);
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  const name = separator === -1 ? modelId : modelId.slice(separator + 1);
  return withoutMaker(
    name
      .split(MODEL_NAME_SEPARATOR)
      .filter((word) => word.length > 0)
      .map((word) =>
        word === GPT ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
      )
      .join(" "),
  );
}

/** What names an agent: its title, the automation whose run started it, and the model it runs on. */
interface NamedAgent {
  readonly title: string | null;
  readonly model: string;
  /** The name of the automation whose run started the agent, as the run started it; none for one started by hand. */
  readonly automationName?: string | undefined;
}

/**
 * An agent as every place names it, its tab, a sidebar row, a card, a
 * notification: its title, or until it has one the name of the automation
 * whose run started it, or else its model's name (`modelLabel`).
 */
export function agentTabLabel(agent: NamedAgent, models?: readonly CatalogModel[]): string {
  return agent.title ?? agent.automationName ?? modelLabel(agent.model, models);
}

import { type CatalogModel, MODEL_PROVIDER } from "./models-wire.js";

export const CATALOG_ID_SEPARATOR = "/";

const MODEL_NAME_SEPARATOR = "-";

const GPT = "gpt";

const MAKER_WORD = "Claude ";

export function catalogIdOf(model: string): string {
  return model.includes(CATALOG_ID_SEPARATOR)
    ? model
    : `${MODEL_PROVIDER.OPENAI}${CATALOG_ID_SEPARATOR}${model}`;
}

function withoutMaker(name: string): string {
  return name.startsWith(MAKER_WORD) ? name.slice(MAKER_WORD.length) : name;
}

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

interface NamedAgent {
  readonly title: string | null;
  readonly model: string;
  readonly automationName?: string | null | undefined;
  readonly automationOrigin?: { readonly name: string } | null | undefined;
}

export function agentName(agent: NamedAgent, models?: readonly CatalogModel[]): string {
  return (
    agent.title ??
    agent.automationName ??
    agent.automationOrigin?.name ??
    modelLabel(agent.model, models)
  );
}

interface AutomationStarted extends Pick<NamedAgent, "automationName" | "automationOrigin"> {
  readonly automationId?: string | null | undefined;
}

export interface AutomationRun {
  readonly name?: string;
}

export function automationRun(agent: AutomationStarted): AutomationRun | undefined {
  const name = agent.automationName ?? agent.automationOrigin?.name;
  if (name !== undefined) return { name };
  return (agent.automationId ?? null) === null ? undefined : {};
}

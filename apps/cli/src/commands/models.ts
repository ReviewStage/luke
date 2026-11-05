/**
 * models.ts -- `vespin models`: the models and efforts an agent may start on, which `agent start --model` and `--effort` take, the member's default marked.
 *
 * The models are the service's (`models.list`), in its catalog's order;
 * the default is the coding-agent part of the member's preferences
 * (`account.preferences`), or, where they stored none, the fallback the
 * service starts them on (`agentFallbackChoice`).
 */

import { agentFallbackChoice, modelChoiceSchema } from "@repo/features/models-wire";
import { Effect, Option, Schema } from "effect";
import { Command } from "effect/cli";
import { answer } from "../output.js";
import { askService, session } from "../session.js";

export const modelsCommand = Command.make("models", {}, () =>
  Effect.gen(function* () {
    const { hosted } = yield* session;
    const { models } = yield* askService(hosted.models.list, undefined);
    const preferences = yield* askService(hosted.account.preferences, undefined);
    const stored = Option.getOrUndefined(
      Schema.decodeUnknownOption(modelChoiceSchema)(preferences.agent),
    );
    const fallback = stored ?? agentFallbackChoice(models);
    const listed = models.map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      efforts: model.efforts,
      default: model.id === fallback.model,
      ...(model.credentialMissing === true ? { credentialMissing: true } : undefined),
    }));
    yield* answer({
      json: { models: listed, default: fallback },
      lines: listed.map(
        (model) =>
          `${model.default ? "*" : " "} ${model.id}  ${model.name}  efforts: ${model.efforts
            .map((effort) => (model.default && effort === fallback.effort ? `${effort}*` : effort))
            .join(", ")}${model.credentialMissing === true ? "  (no credential pays for it)" : ""}`,
      ),
      ids: listed.map(({ id }) => id),
    });
  }),
).pipe(
  Command.withDescription(
    "List the models and efforts agent start --model and --effort take, your default marked *",
  ),
  Command.withExamples([
    { command: "vespin models", description: "The models and their efforts" },
    { command: "vespin models -q", description: "The model ids alone" },
  ]),
);

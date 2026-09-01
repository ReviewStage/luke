import { Effect, Layer } from "effect";
import { text as trimmedText } from "../core.js";
import { HOSTED_OPENAI_ENVIRONMENT, postOpenAi } from "../hosted/openai.js";
import { HostedOpenAi } from "./tags.js";

export const HostedOpenAiLive = Layer.sync(HostedOpenAi, () => {
  const apiKey = trimmedText(process.env[HOSTED_OPENAI_ENVIRONMENT.API_KEY]);
  return {
    apiKey,
    realtimeModel: trimmedText(process.env[HOSTED_OPENAI_ENVIRONMENT.REALTIME_MODEL]),
    attentionModel: trimmedText(process.env[HOSTED_OPENAI_ENVIRONMENT.ATTENTION_MODEL]),
    post: (path, body) =>
      Effect.promise(() => {
        if (!apiKey) return Promise.resolve(undefined);
        return postOpenAi(path, body, { apiKey });
      }),
  };
});

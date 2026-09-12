import { Effect } from "effect";
import { handleMessageRating } from "../../../hosted/message-rating.js";
import { rateMessage, storeWriter } from "../../../hosted/store/index.js";
import { hostedVaultRoute } from "../../../hosted/vault-route.js";
import { runWeb } from "../../../runtime.js";

export default hostedVaultRoute(({ request, resolveUserId }) =>
  handleMessageRating({
    request,
    resolveUserId,
    rate: (userId, messageId, rating) =>
      runWeb(
        Effect.gen(function* () {
          // The route records events alone, which name no tool, so the writer stands over no registry.
          const writer = yield* storeWriter({ tools: {} });
          return yield* rateMessage({ writer }, userId, messageId, rating);
        }),
      ),
  }),
);

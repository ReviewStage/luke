import { handleMessageRating } from "../../../hosted/message-rating.js";
import { rateMessage, storeWriter } from "../../../hosted/store/index.js";
import { hostedVaultRoute } from "../../../hosted/vault-route.js";
import { runWeb } from "../../../runtime.js";

export default hostedVaultRoute(({ request, resolveUserId }) =>
  handleMessageRating({
    request,
    resolveUserId,
    rate: async (userId, messageId, rating) => {
      // The route records events alone, which name no tool, so the writer stands over no registry.
      const writer = await storeWriter({ run: runWeb, tools: {} });
      return rateMessage({ run: runWeb, writer }, userId, messageId, rating);
    },
  }),
);

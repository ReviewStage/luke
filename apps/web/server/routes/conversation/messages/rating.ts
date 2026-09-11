import { getDatabase } from "../../../db/index.js";
import { handleMessageRating } from "../../../hosted/message-rating.js";
import { rateMessage, storeWriter } from "../../../hosted/store/index.js";
import { hostedVaultRoute } from "../../../hosted/vault-route.js";

export default hostedVaultRoute(({ request, resolveUserId }) =>
  handleMessageRating({
    request,
    resolveUserId,
    rate: async (userId, messageId, rating) => {
      const db = getDatabase();
      // The route records events alone, which name no tool, so the writer stands over no registry.
      const writer = await storeWriter({ db, tools: {} });
      return rateMessage({ db, writer }, userId, messageId, rating);
    },
  }),
);

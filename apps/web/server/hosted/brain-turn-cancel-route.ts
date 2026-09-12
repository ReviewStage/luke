import { Effect } from "effect";
import type { Route } from "../route.js";
import { handleBrainTurnCancel } from "./brain-ask.js";
import { brainAskRoute } from "./brain-ask-route.js";
import { CATALOG_TOOL_SET } from "./brain-tool-set.js";
import { type StoreWriter, storeWriter } from "./store/writer.js";

/**
 * The Stop route stands apart from the ask routes because it is the one of
 * them that writes through the store writer: composed here and nowhere the
 * read routes import, so their function bundles never carry the writer and
 * what it reaches.
 */

/** The writer, composed on first use since its composition probes every declared schema; the Stop is its one caller here. */
let composedWriter: StoreWriter | undefined;
const writer: Pick<StoreWriter, "requestTurnCancel"> = {
  requestTurnCancel: (target, cancel) =>
    Effect.gen(function* () {
      composedWriter ??= yield* storeWriter({ tools: CATALOG_TOOL_SET });
      return yield* composedWriter.requestTurnCancel(target, cancel);
    }),
};

/** `POST /api/brain/turns/{id}/cancel`, the path's id rewritten into the query. */
export const brainTurnCancelRouteHandler: Route = brainAskRoute(
  handleBrainTurnCancel,
  (options) => ({
    ...options,
    writer,
  }),
);

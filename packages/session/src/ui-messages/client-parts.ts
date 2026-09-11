import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import type { StoredUIMessage } from "./validate.js";

/**
 * The provider slot a reasoning part keeps its opaque replay item under —
 * the item's id and its encrypted content, written by the brain under
 * `REASONING_PROVIDER_KEY` so the model can replay its own reasoning. The
 * brain sits above this package, so the key is restated here and held equal
 * by the brain's own test.
 */
export const REPLAY_PROVIDER_KEY = "openai";

type StoredPart = UIMessagePart<UIDataTypes, UITools>;

declare const CLIENT_SHAPE: unique symbol;

/**
 * A stored message in the one shape a read route may answer with. The brand
 * key is a module-private `unique symbol`, so a stored message read off a
 * row is never one of these and an object literal cannot be written as one:
 * the whole set is entered at exactly one place, {@link clientUIMessage},
 * which is the strip. A route whose answer type names this shape cannot
 * hand a device an unstripped message, whoever adds the route.
 */
export type ClientUIMessage = StoredUIMessage & { readonly [CLIENT_SHAPE]: true };

/**
 * A stored message as a device may receive it: the row's parts with the
 * replay slot cut from every one. The opaque reasoning item exists for the
 * model's replay and is user-derived data however opaque, so it never leaves
 * the service; the reasoning's summary text stays, which is what a client
 * renders. Any other provider's metadata is left as written. The stored row
 * is untouched — this is the answer's shape, not the record's.
 */
export function clientUIMessage(message: StoredUIMessage): ClientUIMessage {
  // SAFETY: the brand is nominal and carries no run-time field; the strip above is what stands behind it.
  return { ...message, parts: message.parts.map(clientPart) } as ClientUIMessage;
}

function clientPart(part: StoredPart): StoredPart {
  if (!("providerMetadata" in part) || part.providerMetadata === undefined) return part;
  const { [REPLAY_PROVIDER_KEY]: replay, ...kept } = part.providerMetadata;
  if (replay === undefined) return part;
  const cut = { ...part };
  if (Object.keys(kept).length === 0) {
    delete cut.providerMetadata;
  } else {
    cut.providerMetadata = kept;
  }
  return cut;
}

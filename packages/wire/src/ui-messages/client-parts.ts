import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import type { StoredUIMessage } from "./validate.js";

export const REPLAY_PROVIDER_KEY = "openai";

type StoredPart = UIMessagePart<UIDataTypes, UITools>;

declare const CLIENT_SHAPE: unique symbol;

export type ClientUIMessage = StoredUIMessage & { readonly [CLIENT_SHAPE]: true };

export function clientUIMessage(message: StoredUIMessage): ClientUIMessage {
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

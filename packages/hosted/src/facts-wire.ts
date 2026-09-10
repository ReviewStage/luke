import { RECORD_EXTRA_KEYS, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { countedNumber, writtenText } from "./service-wire.js";

/**
 * The facts Luke remembers about the developer, as the service answers them
 * (GET): each the words as Luke kept them, the id a request to forget names,
 * and when it was first remembered, oldest first.
 */
export interface HostedFact {
  id: string;
  words: string;
  createdAt: number;
}

export interface HostedFactsAnswer {
  facts: HostedFact[];
}

const factSchema: Schema<HostedFact> = s.record(
  {
    id: writtenText,
    words: s.text({ ends: TEXT_ENDS.KEEP, allowEmpty: true }),
    createdAt: countedNumber,
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

export const hostedFactsAnswerSchema: Schema<HostedFactsAnswer> = s.record(
  { facts: s.array(factSchema, { skipRefused: true }) },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

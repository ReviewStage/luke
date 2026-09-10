import type { HostedFactsAnswer } from "../../core.js";
import { HOSTED_HTTP_STATUS, jsonResponse } from "../http.js";
import { admitBrainRoute, type HostedBrainRoute } from "./route.js";

const HTTP_METHOD = { GET: "GET" } as const;

/** GET: the facts Luke remembers about the developer, oldest first, as the brain's standing context lists them. */
export async function handleFacts(route: HostedBrainRoute): Promise<Response> {
  const admission = await admitBrainRoute(route, HTTP_METHOD.GET);
  if (admission instanceof Response) return admission;
  const facts = await admission.store.facts.list(admission.userId);
  const answer: HostedFactsAnswer = {
    facts: facts.map((fact) => ({ id: fact.id, words: fact.words, createdAt: fact.createdAt })),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

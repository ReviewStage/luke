import { defaultWebSearch } from "eve/tools/web_search";

/**
 * web_search.ts -- eve's provider-run web search, a worker's: on a Claude model, Anthropic's server search; on a GPT model, OpenAI's.
 *
 * It runs inside the agent's own model call, so it is paid for by whatever
 * pays for that call, the starter's own API key, and never by Luke's.
 */
export default defaultWebSearch;

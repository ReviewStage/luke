import { host, linearConnectionFor } from "../host.js";

/** The account's Linear, for the coding agent, under the agent's own ownership check (`server/hosted/linear-connection.ts`). */
export default linearConnectionFor(host.admit);

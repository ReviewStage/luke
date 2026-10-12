import { host, linearConnectionFor } from "../host.js";

/** The account's Linear, for the planning model, under the root's own ownership check (`server/hosted/linear-connection.ts`). */
export default linearConnectionFor(host.admit);

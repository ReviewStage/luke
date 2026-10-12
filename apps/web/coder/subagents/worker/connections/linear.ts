import { host, linearConnectionFor } from "../../../host.js";

/** The account's Linear, for the worker, under its ownership check alone, since eve hands it none of the agent's connections (`server/hosted/linear-connection.ts`). */
export default linearConnectionFor(host.admitDelegated);

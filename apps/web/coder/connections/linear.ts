import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { host, integrationConnectionFor } from "../host.js";

/** The account's Linear, for the coding agent, under the agent's own ownership check (`server/hosted/integration-connection.ts`). */
export default integrationConnectionFor(INTEGRATION_PROVIDER.LINEAR, host.admit);

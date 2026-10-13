import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { host, integrationConnectionFor } from "../host.js";

/** The account's Notion, for the planning model, under the root's own ownership check (`server/hosted/integration-connection.ts`). */
export default integrationConnectionFor(INTEGRATION_PROVIDER.NOTION, host.admit);

import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { host, integrationConnectionFor } from "../../../host.js";

/** The account's Notion, for the worker, under its ownership check alone, since eve hands it none of the root's connections (`server/hosted/integration-connection.ts`). */
export default integrationConnectionFor(INTEGRATION_PROVIDER.NOTION, host.admitDelegated);

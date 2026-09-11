import { getDatabase } from "../db/index.js";
import { handleChanges } from "../hosted/change-signal.js";
import { deviceSeams } from "../hosted/device-store.js";
import { hostedStoreRoute } from "../hosted/store-route.js";

/**
 * The change signal a device polls: where every resource's read stands now,
 * answered after the device's row has taken its last-seen, presence, and
 * quiet instants. The logic lives in `server/hosted/change-signal.ts`; this
 * file hands it the deployment's store and device writes.
 */
export default hostedStoreRoute((route) =>
  handleChanges({ ...route, touchDevice: deviceSeams(getDatabase()).touchDevice }),
);

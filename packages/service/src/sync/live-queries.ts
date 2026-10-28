/**
 * live-queries.ts -- every live read Luke Sync wakes, by its name, as one registry the registry test reads.
 *
 * A read is moved onto Luke Sync by defining it (`defineLiveQuery`), adding
 * it here, and answering its procedure from the definition
 * (`liveQueryParts`). None is defined yet: each view's own change defines
 * its read, and a read with no definition is looked at on its clock.
 */
import { liveQueryRegistry } from "./live-query.js";

export const LIVE_QUERIES = liveQueryRegistry([]);

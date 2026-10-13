import { writeWithWhereRule } from "../shared/write-with-where.ts";

/** Ban a Drizzle `delete` with no `where`, which reaches every row of its table. */
export const enforceDeleteWithWhereRule = writeWithWhereRule("delete");

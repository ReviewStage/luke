import { PRODUCT_NAME } from "@repo/features/product-name";
import type { ReportedFailure } from "@repo/ui/reported-failure";

const FAILURE_DETAILS = [
  `${PRODUCT_NAME} error details. Include these when you report this problem:`,
  "time: 2026-10-29T18:20:03.198Z",
  "failure.surface: tasks.read",
  "failure.kind: unexpected",
  "failure.code: unread",
].join("\n");

export const CATALOG_FAILURE: ReportedFailure = {
  shown: () => FAILURE_DETAILS,
  hidden: () => undefined,
  copy: (text) => navigator.clipboard.writeText(text),
};

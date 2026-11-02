import { join } from "node:path";
import { expect, it } from "vitest";
import { localPages } from "../server/local-deployment";

const WEB = join(import.meta.dirname, "..");

it.each([
  { path: "/acme/task/t1", page: "/app.html" },
  { path: "/sign-in.html", page: "/sign-in.html" },
])(
  "the local server serves $path from $page, as the deployment's page rewrites do",
  async ({ path, page }) => {
    const pageOf = await localPages(WEB);
    expect(pageOf(path)).toBe(page);
  },
);

import { fileURLToPath } from "node:url";
import { Scanner } from "@tailwindcss/oxide";
import { expect, test } from "vitest";
import { compileTailwindEntry } from "./tailwind.mjs";

const ENTRY = fileURLToPath(new URL("../src/renderer/styles/tailwind.css", import.meta.url));

// A `@source` whose path no longer resolves is not an error to Tailwind: it
// reads nothing and the utilities only it spelled drop out of the stylesheet.
test("every source the renderer's stylesheet names reaches a file", async () => {
  const compiler = await compileTailwindEntry(ENTRY);
  const unread = compiler.sources
    .filter((source) => !source.negated)
    .filter((source) => {
      const scanner = new Scanner({ sources: [source] });
      scanner.scan();
      return scanner.files.length === 0;
    })
    .map((source) => `${source.base} ${source.pattern}`);
  expect(unread).toEqual([]);
});

test("the stylesheet reads Streamdown, which the panel draws replies with", async () => {
  const compiler = await compileTailwindEntry(ENTRY);
  const scanner = new Scanner({ sources: compiler.sources });
  scanner.scan();
  expect(scanner.files.some((file) => /[\\/]streamdown[\\/]dist[\\/]/.test(file))).toBe(true);
});

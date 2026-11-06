import { afterAll, afterEach } from "vitest";

const DUPLICATE_KEY = "Encountered two children with the same key";

const duplicated: unknown[] = [];

const printError = console.error.bind(console);

console.error = (...args: unknown[]) => {
  const [format, key] = args;
  if (typeof format === "string" && format.startsWith(DUPLICATE_KEY)) duplicated.push(key);
  printError(...args);
};

function failOnDuplicated(): void {
  const keys = duplicated.splice(0);
  if (keys.length === 0) return;
  const named = [...new Set(keys.map(String))].map((key) => `\`${key}\``).join(", ");
  throw new Error(
    `Rendered two siblings under one key (${named}), which React may drop, duplicate, or leave behind: key each by a value already its own.`,
  );
}

afterEach(failOnDuplicated);

afterAll(failOnDuplicated);

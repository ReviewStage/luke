import assert from "node:assert/strict";
import { test } from "vitest";
import { pickPersonaName } from "./agent-persona.js";

/** A draw that always lands on the first of a list, so the pick is the first name left free. */
const first = () => 0;

test("a new agent is given a first name alone, skipping first names its task's agents already wear, and any first name once none is free", () => {
  const name = pickPersonaName([], first);
  assert.match(name, /^\S+$/u);
  assert.notEqual(pickPersonaName([name], first), name);
  assert.notEqual(pickPersonaName([`${name} Chen`], first), name);
  const everyone = Array.from({ length: 200 }, (_, index) =>
    pickPersonaName([], () => index / 200),
  );
  assert.match(pickPersonaName(everyone, first), /^\S+$/u);
});

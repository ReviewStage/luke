import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACT_PORT, actPortForwarder } from "./kinds.js";

/**
 * The preload's half of the act port's handshake: one page forwards one
 * port to main, the first it posts to itself, and nothing else it hears.
 */

const PAGE = Symbol("page");
const FRAME = Symbol("another frame");

it("a page's first port is forwarded, and a second one it posts is ignored", () => {
  const forwarded: string[] = [];
  const hear = actPortForwarder<string, symbol>(PAGE, (port) => forwarded.push(port));

  hear({ data: ACT_PORT.REQUEST, source: PAGE, ports: ["first"] });
  hear({ data: ACT_PORT.REQUEST, source: PAGE, ports: ["second"] });

  assert.deepEqual(forwarded, ["first"]);
});

it("a message that is not the page's own handshake forwards nothing, and leaves the handshake open", () => {
  const forwarded: string[] = [];
  const hear = actPortForwarder<string, symbol>(PAGE, (port) => forwarded.push(port));

  hear({ data: ACT_PORT.REQUEST, source: FRAME, ports: ["framed"] });
  hear({ data: "something else", source: PAGE, ports: ["other"] });
  hear({ data: ACT_PORT.REQUEST, source: PAGE, ports: [] });
  hear({ data: ACT_PORT.REQUEST, source: PAGE, ports: ["port"] });

  assert.deepEqual(forwarded, ["port"]);
});

it("a reloaded page, whose preload runs again, forwards a fresh port of its own", () => {
  const forwarded: string[] = [];
  for (const port of ["before the reload", "after the reload"]) {
    const hear = actPortForwarder<string, symbol>(PAGE, (taken) => forwarded.push(taken));
    hear({ data: ACT_PORT.REQUEST, source: PAGE, ports: [port] });
  }

  assert.deepEqual(forwarded, ["before the reload", "after the reload"]);
});

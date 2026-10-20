/**
 * lines.test.ts -- a command's output read back as whole lines however its chunks were cut.
 */

import { describe, expect, it } from "vitest";
import { lineSplitter } from "../src/lines.js";

describe("lineSplitter", () => {
  it("holds a line cut across chunks until the chunk that finishes it", () => {
    const splitter = lineSplitter();

    expect(splitter.push('{"type":"sys')).toEqual([]);
    expect(splitter.push('tem"}\n{"type":"assistant"}\n{"ty')).toEqual([
      '{"type":"system"}',
      '{"type":"assistant"}',
    ]);
    expect(splitter.push('pe":"result"}\n')).toEqual(['{"type":"result"}']);
  });

  it("answers the last line without its newline once the output ends, and blank lines never", () => {
    const splitter = lineSplitter();

    expect(splitter.push("\n\nfirst\n  \nlast")).toEqual(["first"]);
    expect(splitter.flush()).toEqual(["last"]);
    expect(splitter.flush()).toEqual([]);
  });
});

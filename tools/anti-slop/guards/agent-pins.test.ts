import { describe, expect, it } from "vitest";

import { type AgentPins, pinProblems } from "./agent-pins.ts";

const AGREEING: AgentPins = {
  runnerSdkDependency: "0.3.304",
  pinnedSdk: "0.3.304",
  pinnedClaude: "2.1.300",
  installedSdk: "0.3.304",
  installedSdkClaude: "2.1.300",
  codexProtocol: "0.163.0",
  pinnedCodex: "0.163.0",
  eveBaseImage: "vcr.vercel.com/vercel/eve/base:0.74.0",
  installedEve: "0.74.0+build.7",
};

describe("pinProblems", () => {
  it("passes pins that agree, and names each side of every pin moved alone", () => {
    expect(pinProblems(AGREEING)).toEqual([]);
    const drifted = pinProblems({
      ...AGREEING,
      runnerSdkDependency: "^0.3.304",
      installedSdkClaude: "2.1.299",
      pinnedCodex: "0.164.0",
      installedEve: "0.75.0",
    });
    expect(drifted).toHaveLength(4);
    expect(drifted.join("\n")).toContain("^0.3.304 against 0.3.304");
    expect(drifted.join("\n")).toContain("2.1.299 against 2.1.300");
    expect(drifted.join("\n")).toContain("0.163.0 against 0.164.0");
    expect(drifted.join("\n")).toContain(
      "eve/base:0.74.0 against vcr.vercel.com/vercel/eve/base:0.75.0",
    );
  });
});

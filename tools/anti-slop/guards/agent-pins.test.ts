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
  hostClaudePins: [
    {
      name: "CLAUDE_CODE_MAC_PIN",
      version: "0.3.304",
      archive: "https://registry.npmjs.org/claude-agent-sdk-darwin-arm64-0.3.304.tgz",
    },
  ],
  hostCodexPins: [
    {
      name: "CODEX_LINUX_PINS.x64",
      version: "0.163.0",
      archive: "https://registry.npmjs.org/codex-0.163.0-linux-x64.tgz",
    },
  ],
  eveBaseImage: "vcr.vercel.com/vercel/eve/base:0.74.0",
  ociBaseImage: "ghcr.io/vercel/eve:0.74.0@sha256:13059d8c",
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
      hostClaudePins: [
        {
          name: "CLAUDE_CODE_MAC_PIN",
          version: "0.3.304",
          archive: "https://registry.npmjs.org/claude-agent-sdk-darwin-arm64-0.3.303.tgz",
        },
      ],
    });
    expect(drifted).toHaveLength(7);
    expect(drifted.join("\n")).toContain("^0.3.304 against 0.3.304");
    expect(drifted.join("\n")).toContain("2.1.299 against 2.1.300");
    expect(drifted.join("\n")).toContain("0.163.0 against 0.164.0");
    expect(drifted.join("\n")).toContain("CODEX_LINUX_PINS.x64.VERSION against CODEX_PIN.VERSION");
    expect(drifted.join("\n")).toContain("CLAUDE_CODE_MAC_PIN.ARCHIVE names no 0.3.304");
    expect(drifted.join("\n")).toContain(
      "eve/base:0.74.0 against vcr.vercel.com/vercel/eve/base:0.75.0",
    );
    expect(drifted.join("\n")).toContain("eve:0.74.0 against ghcr.io/vercel/eve:0.75.0");
  });
});

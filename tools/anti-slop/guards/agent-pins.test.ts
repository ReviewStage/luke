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
  pinnedPlaywright: "1.64.1",
  imageArgs: {
    CLAUDE_AGENT_SDK_VERSION: "0.3.304",
    CLAUDE_CODE_VERSION: "2.1.300",
    CODEX_VERSION: "0.163.0",
    PLAYWRIGHT_VERSION: "1.64.1",
  },
};

describe("pinProblems", () => {
  it("passes pins that agree, and names each side of every pin moved alone", () => {
    expect(pinProblems(AGREEING)).toEqual([]);
    const drifted = pinProblems({
      ...AGREEING,
      runnerSdkDependency: "^0.3.304",
      installedSdkClaude: "2.1.299",
      pinnedCodex: "0.164.0",
      imageArgs: { ...AGREEING.imageArgs, PLAYWRIGHT_VERSION: "1.63.0" },
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
    expect(drifted.join("\n")).toContain("Dockerfile's CODEX_VERSION against CODEX_PIN.VERSION");
    expect(drifted.join("\n")).toContain("1.63.0 against 1.64.1");
  });
});

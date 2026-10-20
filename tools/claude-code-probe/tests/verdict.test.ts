/**
 * verdict.test.ts -- which of P00's conditions hold for what a run observed: a run that did everything passes both checks, and each way the plan or the token could fail fails the condition that names it.
 *
 * The streams are built in the SDK's message shapes (`@anthropic-ai/claude-agent-sdk`
 * 0.3.304's `SDKMessage`), the fields the verdict reads and a few it does not.
 */

import type { WireValue } from "@luke/wire";
import { describe, expect, it } from "vitest";
import {
  CHECK,
  type Condition,
  type ProbeObservations,
  passed,
  TURN_DONE,
  verdict,
} from "../src/verdict.js";

const NONCE = "a1b2c3d4e5f6";
const SESSION = "00000000-0000-4000-8000-000000000001";

const NO_CAPABILITIES = "0000000000000000";
const FULL_CAPABILITIES = "000001ffffffffff";

const PRIVATE_REPORT = {
  sudo: false,
  env_token: false,
  proc_environ_with_token: 0,
  files_with_token_shape: 0,
  shadow_readable: false,
  cap_eff: NO_CAPABILITIES,
};

/** A Terminal's shell with its capabilities dropped, which reads nothing of the agent's. */
const TERMINAL_CAPS_DROPPED = {
  user: "vercel-sandbox",
  ...PRIVATE_REPORT,
  agent_home_listable: false,
  anthropic_http: "401",
};

function init(sessionId: string, apiKeySource = "none"): WireValue {
  return {
    type: "system",
    subtype: "init",
    session_id: sessionId,
    apiKeySource,
    claude_code_version: "2.1.304",
    cwd: "/workspace/repository",
    tools: ["Bash", "Edit", "Write", "ScheduleWakeup"],
    model: "claude-sonnet",
  };
}

function account(subscriptionType: string): WireValue {
  return { type: "luke_probe_account", subscriptionType, apiProvider: "firstParty" };
}

function toolUse(name: string, input: WireValue): WireValue {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: `toolu_${name}`, name, input }] },
    parent_tool_use_id: null,
    session_id: SESSION,
  };
}

function said(text: string): WireValue {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    parent_tool_use_id: null,
    session_id: SESSION,
  };
}

function leakResult(report: WireValue): WireValue {
  return {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_Bash",
          content: [{ type: "text", text: `LUKE_PROBE_LEAK_CHECK ${JSON.stringify(report)}\n` }],
        },
      ],
    },
    parent_tool_use_id: null,
  };
}

function result(sessionId: string, subtype = "success"): WireValue {
  return { type: "result", subtype, is_error: subtype !== "success", session_id: sessionId };
}

function firstLaunch(
  overrides: { readonly apiKeySource?: string; readonly agentReport?: WireValue } = {},
) {
  return [
    init(SESSION, overrides.apiKeySource),
    account("max"),
    toolUse("Write", { file_path: `luke-probe/${NONCE}.txt`, content: NONCE }),
    toolUse("Bash", { command: "bash /opt/luke-probe/leak-check.sh" }),
    leakResult(
      overrides.agentReport ?? {
        user: "agent",
        ...PRIVATE_REPORT,
        agent_home_listable: true,
        anthropic_http: "000",
      },
    ),
    toolUse("Bash", { command: `sleep 45 && echo done`, run_in_background: true }),
    toolUse("ScheduleWakeup", { delaySeconds: 60, reason: "wait", prompt: "go", noop: false }),
    result(SESSION),
    said(TURN_DONE.FIRST),
    result(SESSION),
    toolUse("Bash", { command: "sleep 600" }),
    result(SESSION, "error_during_execution"),
  ];
}

function observations(overrides: Partial<ProbeObservations> = {}): ProbeObservations {
  return {
    nonce: NONCE,
    sudoApiUser: "root",
    launchUser: "agent",
    launchCapEff: NO_CAPABILITIES,
    firstLaunch: firstLaunch(),
    stoppedTurnEnded: true,
    branchPushed: true,
    sessionFilesBeforeStop: [`/home/agent/.claude/projects/-workspace-repository/${SESSION}.jsonl`],
    sessionFilesAfterResume: [
      `/home/agent/.claude/projects/-workspace-repository/${SESSION}.jsonl`,
    ],
    resumedLaunch: [
      init(SESSION),
      said(`luke-probe/${NONCE}.txt\n${TURN_DONE.RESUMED}`),
      result(SESSION),
    ],
    terminalAsToday: TERMINAL_CAPS_DROPPED,
    terminalCapsDropped: TERMINAL_CAPS_DROPPED,
    agentUid: {
      user: "agent",
      ...PRIVATE_REPORT,
      agent_home_listable: true,
      anthropic_http: "401",
    },
    bubblewrapCapsKept: "started",
    bubblewrapCapsDropped: "started",
    rootFilesWithTokenShape: 0,
    ...overrides,
  };
}

function failing(conditions: readonly Condition[]): readonly string[] {
  return conditions.filter((each) => !each.pass).map((each) => each.name);
}

describe("verdict", () => {
  it("passes both checks for a run that did everything the plan asks", () => {
    const conditions = verdict(observations());

    expect(failing(conditions)).toEqual([]);
    expect(passed(conditions.filter((each) => each.check === CHECK.PLAN))).toBe(true);
    expect(passed(conditions.filter((each) => each.check === CHECK.TOKEN))).toBe(true);
  });

  it("fails the billing condition when the CLI ran on an API key", () => {
    const conditions = verdict(
      observations({ firstLaunch: firstLaunch({ apiKeySource: "ANTHROPIC_API_KEY" }) }),
    );

    expect(failing(conditions)).toEqual(["Anthropic bills the plan"]);
  });

  it("fails the token check when a command the agent runs sees the token", () => {
    const conditions = verdict(
      observations({
        firstLaunch: firstLaunch({
          agentReport: {
            user: "agent",
            ...PRIVATE_REPORT,
            env_token: true,
            agent_home_listable: true,
            anthropic_http: "200",
          },
        }),
      }),
    );

    expect(failing(conditions)).toEqual([
      "a command the agent runs cannot read the token",
      "a command the agent runs cannot call Anthropic",
    ]);
  });

  it("fails the token check when a Terminal's shell, capabilities dropped, keeps sudo or can list the agent's home", () => {
    const conditions = verdict(
      observations({
        terminalCapsDropped: { ...TERMINAL_CAPS_DROPPED, sudo: true, agent_home_listable: true },
      }),
    );

    expect(failing(conditions)).toEqual([
      "a Terminal's shell, capabilities dropped, has no sudo and no capabilities",
      "a Terminal's shell, capabilities dropped, cannot read the token, the session, or /etc/shadow",
    ]);
    expect(passed(conditions)).toBe(false);
  });

  it("reports a Terminal's shell as it is today reading the token without failing the check that rests on dropped capabilities", () => {
    const conditions = verdict(
      observations({
        terminalAsToday: {
          ...TERMINAL_CAPS_DROPPED,
          cap_eff: FULL_CAPABILITIES,
          proc_environ_with_token: 1,
          shadow_readable: true,
        },
        agentUid: {
          user: "agent",
          ...PRIVATE_REPORT,
          proc_environ_with_token: 1,
          agent_home_listable: true,
          anthropic_http: "401",
        },
        bubblewrapCapsKept: "refused",
      }),
    );

    expect(failing(conditions)).toEqual([
      "a Terminal's shell as it is today, capabilities kept, cannot read the token",
      "the agent's own uid, outside the command sandbox, cannot read the CLI's environment",
      "bubblewrap starts in a Terminal's shell as it is today, capabilities kept",
    ]);
    expect(passed(conditions)).toBe(true);
  });

  it("fails the drop to the agent user when the launch kept a capability", () => {
    expect(failing(verdict(observations({ launchCapEff: FULL_CAPABILITIES })))).toEqual([
      "Claude Code runs as the agent user with no capabilities",
    ]);
  });

  it("fails the resume condition when the relaunch started another session or forgot the first turn", () => {
    const other = "00000000-0000-4000-8000-000000000009";

    expect(
      failing(verdict(observations({ resumedLaunch: [init(other), said(TURN_DONE.RESUMED)] }))),
    ).toEqual(["a relaunch with resume continued the session"]);
  });

  it("fails what the run never reached when it stopped early, and the drop to agent when sudo was lost", () => {
    const conditions = verdict(
      observations({
        sudoApiUser: undefined,
        launchUser: undefined,
        launchCapEff: undefined,
        firstLaunch: [],
        stoppedTurnEnded: false,
        branchPushed: false,
        sessionFilesBeforeStop: [],
        sessionFilesAfterResume: [],
        resumedLaunch: [],
        terminalAsToday: undefined,
        terminalCapsDropped: undefined,
        agentUid: undefined,
        bubblewrapCapsKept: undefined,
        bubblewrapCapsDropped: undefined,
        rootFilesWithTokenShape: undefined,
      }),
    );

    expect(conditions.every((each) => !each.pass)).toBe(true);
  });
});

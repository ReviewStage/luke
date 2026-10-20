import { describe, expect, it } from "vitest";
import { LineSplitter, launchSpec, readServerLine } from "./app-server.js";

describe("launchSpec", () => {
  const spec = launchSpec({ accessToken: "access-secret" });

  it("carries the token in the process environment alone, never in argv", () => {
    expect(spec.env.ACCESS_TOKEN).toBe("access-secret");
    expect(spec.args.join(" ")).not.toContain("access-secret");
    expect(spec.cmd).not.toContain("access-secret");
  });

  it("drops to agent with every capability set emptied, through the API's root rather than argv-borne env", () => {
    expect(spec.sudo).toBe(true);
    expect(spec.cmd).toBe("setpriv");
    expect(spec.args.slice(0, spec.args.indexOf("--"))).toEqual([
      "--reuid=agent",
      "--regid=agent",
      "--init-groups",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--bounding-set=-all",
    ]);
    expect(spec.env).toMatchObject({
      HOME: "/home/agent",
      CODEX_HOME: "/home/agent/.codex",
      USER: "agent",
    });
  });

  it("starts app-server on stdio with OpenAI's documented ChatGPT-plan provider", () => {
    const overrides = spec.args.filter((_, index) => spec.args[index - 1] === "-c");
    expect(spec.args.slice(spec.args.indexOf("--") + 1, spec.args.indexOf("--") + 5)).toEqual([
      "/opt/luke-codex/bin/codex",
      "app-server",
      "--listen",
      "stdio://",
    ]);
    expect(overrides).toEqual(
      expect.arrayContaining([
        'model_provider="openai_chatgpt_plan"',
        'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"',
        'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"',
        'model_providers.openai_chatgpt_plan.wire_api="responses"',
        "model_providers.openai_chatgpt_plan.requires_openai_auth=false",
        "model_providers.openai_chatgpt_plan.supports_websockets=false",
        'shell_environment_policy.inherit="core"',
        'shell_environment_policy.exclude=["ACCESS_TOKEN"]',
      ]),
    );
  });
});

describe("LineSplitter", () => {
  it("keeps a line broken across chunks until its newline arrives", () => {
    const lines = new LineSplitter();
    expect(lines.push('{"a":')).toEqual([]);
    expect(lines.push('1}\n{"b":2}\r\n\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(lines.push(":3}\n")).toEqual(['{"c":3}']);
  });
});

describe("readServerLine", () => {
  it("tells responses, notifications and the server's own requests apart", () => {
    expect(readServerLine('{"id":3,"result":{"turnId":"t"}}')).toMatchObject({
      kind: "response",
      id: 3,
    });
    expect(readServerLine('{"id":4,"error":{"code":1}}')).toMatchObject({
      kind: "response",
      error: { code: 1 },
    });
    expect(readServerLine('{"method":"turn/started","params":{"threadId":"x"}}')).toMatchObject({
      kind: "notification",
      method: "turn/started",
    });
    expect(
      readServerLine('{"id":"r1","method":"item/commandExecution/requestApproval","params":{}}'),
    ).toMatchObject({
      kind: "request",
      id: "r1",
    });
    expect(readServerLine("WARNING: not json")).toMatchObject({ kind: "unreadable" });
  });
});

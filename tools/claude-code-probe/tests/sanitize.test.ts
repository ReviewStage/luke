/**
 * sanitize.test.ts -- what a fixture keeps of the SDK's stream: its shape, never a token, an account, an email, or a real id.
 *
 * Every credential here is built at run time from a low-entropy fake, so no
 * tracked line is shaped like a live one.
 */

import { describe, expect, it } from "vitest";
import { REDACTED, sanitizer } from "../src/sanitize.js";

const fakeClaudeToken = ["sk", "ant", "oat01", "x".repeat(40)].join("-");
const fakeGithubToken = `gh${"p"}_${"a".repeat(36)}`;
const SESSION = "6F1C2B9E-0D4A-4C8E-9B1F-2A3D4E5F6A7B";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";

describe("sanitizer", () => {
  it("removes the run's secrets wherever they appear, inside text and keys alike", () => {
    const scrub = sanitizer({ secrets: [fakeClaudeToken, "plain-secret-value"], replacements: [] });

    const out = scrub({
      type: "user",
      message: { content: [{ type: "tool_result", content: `env: TOKEN=plain-secret-value;` }] },
      [`plain-secret-value`]: true,
    });

    expect(JSON.stringify(out)).not.toContain("plain-secret-value");
    expect(JSON.stringify(out)).toContain(REDACTED.SECRET);
  });

  it("removes credential and email shapes the run never held", () => {
    const scrub = sanitizer({ secrets: [], replacements: [] });

    const out = JSON.stringify(
      scrub([
        `token ${fakeClaudeToken} in a log`,
        `push with ${fakeGithubToken}`,
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
        "signed in as someone@example.org",
      ]),
    );

    expect(out).not.toContain(fakeClaudeToken);
    expect(out).not.toContain(fakeGithubToken);
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("someone@example.org");
    expect(out).toContain(REDACTED.EMAIL);
  });

  it("redacts account and organization fields by name and keeps what says who pays", () => {
    const scrub = sanitizer({ secrets: [], replacements: [] });

    expect(
      scrub({
        type: "luke_probe_account",
        email: "someone@example.org",
        organization: "Someone's Individual Org",
        subscriptionType: "max",
        tokenSource: "CLAUDE_CODE_OAUTH_TOKEN",
        apiProvider: "firstParty",
      }),
    ).toEqual({
      type: "luke_probe_account",
      email: REDACTED.ACCOUNT,
      organization: REDACTED.ACCOUNT,
      subscriptionType: "max",
      tokenSource: "CLAUDE_CODE_OAUTH_TOKEN",
      apiProvider: "firstParty",
    });
  });

  it("numbers ids by first appearance, so one that recurs across a resume still recurs", () => {
    const scrub = sanitizer({ secrets: [], replacements: [] });

    const first = scrub({ type: "system", subtype: "init", session_id: SESSION, uuid: OTHER });
    const resumed = scrub({ type: "system", subtype: "init", session_id: SESSION.toLowerCase() });

    expect(first).toEqual({
      type: "system",
      subtype: "init",
      session_id: "00000000-0000-4000-8000-000000000001",
      uuid: "00000000-0000-4000-8000-000000000002",
    });
    expect(resumed).toEqual({
      type: "system",
      subtype: "init",
      session_id: "00000000-0000-4000-8000-000000000001",
    });
  });

  it("replaces what names the developer, such as the repository's owner", () => {
    const scrub = sanitizer({
      secrets: [],
      replacements: [
        ["octo-dev/scratch", "luke-probe-owner/throwaway"],
        ["octo-dev", "luke-probe-owner"],
      ],
    });

    expect(scrub("To github.com/octo-dev/scratch.git, cloned by octo-dev")).toBe(
      "To github.com/luke-probe-owner/throwaway.git, cloned by luke-probe-owner",
    );
  });

  it("leaves a sanitized value unchanged when sanitized again", () => {
    const value = {
      session_id: SESSION,
      text: `as someone@example.org with ${fakeClaudeToken}`,
      email: "someone@example.org",
    };
    const once = sanitizer({ secrets: [], replacements: [] })(value);

    expect(sanitizer({ secrets: [], replacements: [] })(once)).toEqual(once);
  });
});

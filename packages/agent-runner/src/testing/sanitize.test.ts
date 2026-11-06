import { describe, expect, it } from "vitest";
import { findLeaks, type KnownSecret, Sanitizer, SECRET_KIND } from "./sanitize.js";

// Note that these shapes are assembled at run time, because the repository check refuses a
// tracked literal shaped like a provider's credential.
const JWT = ["eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJ4In0", "c2lnbmF0dXJlLXZhbHVl"].join(".");
const ISSUED = ["oaiapp", "abc123"].join("_");
const SECRETS: readonly KnownSecret[] = [
  { kind: SECRET_KIND.ACCESS_TOKEN, value: "opaque-access-value" },
  { kind: SECRET_KIND.HOST_ID, value: "urn:uuid:11111111-1111-4111-8111-111111111111" },
];

describe("Sanitizer", () => {
  it("replaces known secrets, credential shapes, addresses and home owners wherever a string holds them", () => {
    const sanitizer = new Sanitizer(SECRETS);
    const out = sanitizer.value({
      text: `Bearer opaque-access-value and ${JWT} for ${ISSUED} at dev@example.org in /Users/charles/x`,
      host: "urn:uuid:11111111-1111-4111-8111-111111111111",
    });
    expect(out).toEqual({
      text: "Bearer <redacted:access-token> and <redacted:jwt> for <redacted:issued-client-id> at user@example.com in /Users/<user>/x",
      host: "<redacted:ext-agent-host-id>",
    });
  });

  it("blanks fields that identify an account whatever they hold", () => {
    const out = new Sanitizer([]).value({
      account: { email: "x", accountId: "acct-1", planType: "pro" },
    });
    expect(out).toEqual({
      account: { email: "<redacted>", accountId: "<redacted>", planType: "pro" },
    });
  });

  it("renames each id to the same placeholder everywhere in one recording, and different ids apart", () => {
    const sanitizer = new Sanitizer([]);
    const thread = "01a15a91-0399-7151-b7a4-8ad77a6dd031";
    const turn = "01a15a91-04aa-7c10-9d37-a5569bca1629";
    const first = sanitizer.value({ threadId: thread, turn: { id: turn } });
    const second = sanitizer.value({ path: `/home/agent/.codex/sessions/rollout-${thread}.jsonl` });
    expect(first).toEqual({
      threadId: "00000000-0000-4000-8000-000000000001",
      turn: { id: "00000000-0000-4000-8000-000000000002" },
    });
    expect(second).toEqual({
      path: "/home/agent/.codex/sessions/rollout-00000000-0000-4000-8000-000000000001.jsonl",
    });
  });
});

describe("findLeaks", () => {
  it("finds a known secret or a credential shape, and nothing in what the sanitizer wrote", () => {
    const raw = `token opaque-access-value, ${JWT}, mail dev@example.org`;
    expect(findLeaks(raw, SECRETS)).toEqual(["access-token", "jwt", "email"]);
    expect(findLeaks(new Sanitizer(SECRETS).text(raw), SECRETS)).toEqual([]);
  });
});

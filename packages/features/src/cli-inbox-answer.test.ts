import { describe, expect, it } from "vitest";
import { cliInboxAnswer } from "./cli-inbox-answer.js";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  type InboxAsking,
} from "./inbox-wire.js";

const MESSAGE_ID = "6b1c7f2e-0d4a-4c1b-9a51-3f0f6d2a7e10";

function asking(ask: Record<string, unknown>): InboxAsking {
  const read = { ...ask, status: INBOX_ASK_STATUS.OPEN } as InboxAsking["ask"];
  return {
    message: {
      id: MESSAGE_ID,
      author: INBOX_MESSAGE_AUTHOR.AGENT,
      text: "?",
      ask: read,
      createdAt: 1,
    },
    ask: read,
  };
}

const DECIDE = asking({
  type: INBOX_ASK.DECIDE,
  options: [{ label: "Approve" }, { label: "Request changes" }],
});
const DO = asking({ type: INBOX_ASK.DO, steps: ["Add the secret", "Rerun the job"] });
const FORM = asking({
  type: INBOX_ASK.ANSWER,
  fields: [
    { type: "text", label: "Region", required: true },
    { type: "number", label: "Replicas" },
  ],
});
const WORDS = asking({ type: INBOX_ASK.ANSWER });

describe("cliInboxAnswer", () => {
  it.each([
    [
      "a decide's option, whatever its case",
      DECIDE,
      { words: ["request CHANGES"] },
      { text: "", answers: { ask: MESSAGE_ID, reply: "chose", choices: ["Request changes"] } },
    ],
    [
      "a to-do marked done, every step ticked",
      DO,
      { words: ["done"] },
      { text: "", answers: { ask: MESSAGE_ID, reply: "done", steps: [0, 1] } },
    ],
    [
      "a form's values from a JSON object by field",
      FORM,
      { words: [], input: '{"region": "us-east-1", "Replicas": 3}' },
      {
        text: "",
        answers: {
          ask: MESSAGE_ID,
          reply: "submitted",
          values: [
            { label: "Region", value: "us-east-1" },
            { label: "Replicas", value: 3 },
          ],
        },
      },
    ],
    [
      "an answer of words alone",
      WORDS,
      { words: ["use", "staging"] },
      { text: "use staging", answers: { ask: MESSAGE_ID, reply: "answered" } },
    ],
  ])("sends %s", (_case, open, given, sent) => {
    expect(cliInboxAnswer(open, given)).toEqual(sent);
  });

  it.each([
    ["an option the decide does not offer", DECIDE, { words: ["Ship it"] }],
    ["a form given as words", FORM, { words: ["us-east-1"] }],
    ["a form value of the wrong type", FORM, { words: [], input: '{"Replicas": "three"}' }],
    ["a thread with no open ask", undefined, { words: ["Approve"] }],
  ])("refuses %s", (_case, open, given) => {
    expect(cliInboxAnswer(open, given)).toHaveProperty("refusal");
  });
});

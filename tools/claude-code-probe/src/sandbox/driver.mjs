// driver.mjs -- the probe's stand-in for P05's runner, run in the sandbox as the agent user: query() in streaming input mode, Luke's lines in on stdin, the SDK's messages out on stdout.
//
// The first stdin line is the config: the token, the model, the working
// directory, the session to resume, and the options `query()` runs with.
// The token goes into the CLI's own environment and nowhere else; it is
// never printed. Each later line is a message for the session, a stop
// (`interrupt()`), or the end of input. Every SDK message is printed as one
// line of JSON, and the account the CLI is signed in as once the session has
// started, which the probe sanitizes before anything is kept.

import { EventEmitter, on } from "node:events";
import { createInterface } from "node:readline";
import { query } from "@anthropic-ai/claude-agent-sdk";

const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY })[
  Symbol.asyncIterator
]();

function emit(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const first = await lines.next();
const config = JSON.parse(first.value);
const env = { ...process.env, [config.tokenVariable]: config.token };
config.token = undefined;

// Note that stdin is read by a loop of its own rather than inside the prompt
// stream, so a stop reaches interrupt() while a turn runs (a foreground
// command included) whether or not the SDK is asking for the next prompt.
const inbox = new EventEmitter();
const messages = on(inbox, "message");

async function* prompts() {
  for await (const [text] of messages) {
    yield {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      origin: { kind: "human" },
    };
  }
}

const options = { ...config.options, cwd: config.cwd, model: config.model, env };
if (config.resume !== undefined) options.resume = config.resume;
const session = query({ prompt: prompts(), options });

async function readCommands() {
  for (;;) {
    const next = await lines.next();
    if (next.done) break;
    const line = JSON.parse(next.value);
    if (line.type === "end") break;
    if (line.type === "stop") await session.interrupt();
    else inbox.emit("message", line.text);
  }
  await messages.return();
}

readCommands().catch((error) => {
  emit({ type: "luke_probe_error", message: String(error?.message ?? error) });
});

try {
  let askedAccount = false;
  for await (const message of session) {
    emit(message);
    if (!askedAccount && message.type === "system" && message.subtype === "init") {
      askedAccount = true;
      emit({ type: "luke_probe_account", ...(await session.accountInfo()) });
    }
  }
} catch (error) {
  emit({ type: "luke_probe_error", message: String(error?.message ?? error) });
}
emit({ type: "luke_probe_exit" });

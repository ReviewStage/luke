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
  emit({ type: "agent_probe_error", message: String(error?.message ?? error) });
});

try {
  let askedAccount = false;
  for await (const message of session) {
    emit(message);
    if (!askedAccount && message.type === "system" && message.subtype === "init") {
      askedAccount = true;
      emit({ type: "agent_probe_account", ...(await session.accountInfo()) });
    }
  }
} catch (error) {
  emit({ type: "agent_probe_error", message: String(error?.message ?? error) });
}
emit({ type: "agent_probe_exit" });

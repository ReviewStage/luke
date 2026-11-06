import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { RECORDING_CURSOR_SOURCE } from "@repo/service/agents/browser/recording-cursor";
import { AGENT_IMAGE_REPOSITORY } from "@repo/service/agents/coder-host/agent-image";

const WEB = join(import.meta.dirname, "..");

const SOURCE = {
  DIRECTORY: join(WEB, "agent-image"),
  COMMITTED: ["Dockerfile", "tmux.conf"],
  RUNNER_BUNDLE: join(WEB, "..", "..", "packages", "agent-runner", "dist", "agent-runner.mjs"),
} as const;

const TAG_DIGITS = 24;

interface ContextFile {
  readonly name: string;
  readonly contents: Uint8Array;
}

async function agentImageContext(): Promise<readonly ContextFile[]> {
  const runnerBundle = await readFile(SOURCE.RUNNER_BUNDLE).catch(() => {
    throw new Error(
      `${relative(WEB, SOURCE.RUNNER_BUNDLE)} is missing: run \`pnpm --filter @repo/agent-runner build\` first`,
    );
  });
  const committed = await Promise.all(
    SOURCE.COMMITTED.map(async (name) => ({
      name,
      contents: await readFile(join(SOURCE.DIRECTORY, name)),
    })),
  );
  return [
    ...committed,
    { name: "agent-runner.mjs", contents: runnerBundle },
    { name: "cursor.js", contents: Buffer.from(RECORDING_CURSOR_SOURCE, "utf8") },
  ];
}

function agentImageTag(context: readonly ContextFile[]): string {
  const digest = createHash("sha256");
  for (const file of context)
    digest.update(file.name).update("\0").update(file.contents).update("\0");
  return digest.digest("hex").slice(0, TAG_DIGITS);
}

export async function agentImageReference(): Promise<string> {
  return `${AGENT_IMAGE_REPOSITORY}:${agentImageTag(await agentImageContext())}`;
}

async function stageAgentImage(directory: string): Promise<string> {
  const context = await agentImageContext();
  await mkdir(directory, { recursive: true });
  await Promise.all(context.map((file) => writeFile(join(directory, file.name), file.contents)));
  return agentImageTag(context);
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  const directory = process.argv[2];
  if (directory === undefined) throw new Error("usage: tsx scripts/agent-image.ts <directory>");
  // biome-ignore lint/suspicious/noConsole: the tag is the script's answer, which CI reads off its output.
  console.log(await stageAgentImage(directory));
}

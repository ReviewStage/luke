import { spawn } from "node:child_process";
import { Cause, Context, Effect, Exit, Layer } from "effect";
import { INVOCATION_FAILURE, InvocationError } from "./errors.js";
import type { BoundedInvocationOptions, BoundedInvocationResult } from "./options.js";
import { invocationPath } from "./path.js";

export interface BoundedProcessService {
  readonly invoke: (
    options: BoundedInvocationOptions,
  ) => Effect.Effect<BoundedInvocationResult, InvocationError>;
}

export class BoundedProcess extends Context.Tag("@sidecar/process/BoundedProcess")<
  BoundedProcess,
  BoundedProcessService
>() {}

function failureFromSpawnError(
  error: NodeJS.ErrnoException,
  binary: string,
  killed: boolean,
): InvocationError {
  const failure =
    error.code === "ENOENT"
      ? INVOCATION_FAILURE.UNAVAILABLE
      : error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ? INVOCATION_FAILURE.OUTPUT_LIMIT
        : killed || error.code === "ETIMEDOUT"
          ? INVOCATION_FAILURE.TIMED_OUT
          : INVOCATION_FAILURE.FAILED;
  return new InvocationError(failure, binary);
}

function boundedInvocationEffect(
  options: BoundedInvocationOptions,
): Effect.Effect<BoundedInvocationResult, InvocationError> {
  return Effect.async<BoundedInvocationResult, InvocationError>((resume) => {
    const child = spawn(options.binary, [...options.arguments], {
      windowsHide: true,
      env: {
        ...process.env,
        PATH: invocationPath(options.pathDirectories),
      },
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputLimited = false;

    const settleSuccess = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resume(Effect.succeed({ exitCode, stdout, stderr }));
    };

    const settleFailure = (error: InvocationError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resume(Effect.fail(error));
    };

    const appendOutput = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const nextBytes = chunk.byteLength;
      const used = stream === "stdout" ? stdoutBytes : stderrBytes;
      if (used + nextBytes > options.maximumOutputBytes) {
        outputLimited = true;
        child.kill();
        return;
      }
      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        stdoutBytes += nextBytes;
        stdout += text;
      } else {
        stderrBytes += nextBytes;
        stderr += text;
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => appendOutput(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => appendOutput(chunk, "stderr"));

    child.once("error", (error) => {
      settleFailure(failureFromSpawnError(error, options.binary, false));
    });

    child.once("close", (code, signal) => {
      if (outputLimited) {
        settleFailure(new InvocationError(INVOCATION_FAILURE.OUTPUT_LIMIT, options.binary));
        return;
      }
      if (timedOut) {
        settleFailure(new InvocationError(INVOCATION_FAILURE.TIMED_OUT, options.binary));
        return;
      }
      if (signal !== null) {
        settleFailure(new InvocationError(INVOCATION_FAILURE.FAILED, options.binary));
        return;
      }
      settleSuccess(code ?? 0);
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    timeoutHandle.unref?.();

    return Effect.sync(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
    });
  });
}

export const BoundedProcessLive: Layer.Layer<BoundedProcess> = Layer.succeed(BoundedProcess, {
  invoke: boundedInvocationEffect,
});

/** Runs one bounded invocation with the live process service. Tests and Promise edges only. */
export function runBoundedInvocation(
  options: BoundedInvocationOptions,
): Promise<BoundedInvocationResult> {
  return Effect.runPromiseExit(
    BoundedProcess.pipe(
      Effect.flatMap((process) => process.invoke(options)),
      Effect.provide(BoundedProcessLive),
    ),
  ).then((exit) => {
    if (Exit.isFailure(exit)) {
      throw Cause.squash(exit.cause);
    }
    return exit.value;
  });
}

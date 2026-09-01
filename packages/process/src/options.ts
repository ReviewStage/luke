export interface BoundedInvocationOptions {
  binary: string;
  arguments: readonly string[];
  timeoutMs: number;
  maximumOutputBytes: number;
  /** Appended after the inherited PATH, so the user's own resolution still wins. */
  pathDirectories?: readonly string[];
}

export interface BoundedInvocationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { SUPERSET_SIGN_IN_STAGE, type SupersetSignInSnapshot } from "./shared/contracts";
import type { SupersetCli } from "./superset-cli";

const SIGN_IN_TIMEOUT_MS = 3 * 60_000;
const OUTPUT_TAIL_LIMIT = 16_384;
const CODE_LIMIT = 512;
const AUTHORIZATION_HOST = "api.superset.sh";
const AUTHORIZATION_PATH = "/api/auth/oauth2/authorize";

type LoginChild = Pick<
  ChildProcessWithoutNullStreams,
  "stdin" | "stdout" | "stderr" | "kill" | "once" | "removeAllListeners"
>;

export interface SupersetSignInOptions {
  cli: SupersetCli;
  openExternal: (url: string) => Promise<unknown>;
  onChange: (snapshot: SupersetSignInSnapshot) => void;
  spawnLogin?: (executable: string, arguments_: readonly string[]) => LoginChild;
  timeoutMs?: number;
}

function snapshot(
  stage: SupersetSignInSnapshot["stage"],
  options: Pick<SupersetSignInSnapshot, "failure" | "organizations"> = {
    organizations: [],
  },
): SupersetSignInSnapshot {
  return {
    stage,
    organizations: options.organizations,
    ...(options.failure ? { failure: options.failure } : {}),
  };
}

function authorizationUrl(text: string): string | undefined {
  for (const match of text.matchAll(/https:\/\/[^\s"'<>]+/gu)) {
    try {
      const candidate = new URL(match[0].replace(/[),.;]+$/u, ""));
      if (
        candidate.hostname === AUTHORIZATION_HOST &&
        candidate.pathname === AUTHORIZATION_PATH &&
        candidate.protocol === "https:"
      ) {
        return candidate.toString();
      }
    } catch {}
  }
  return undefined;
}

export function validSupersetSignInCode(code: string): boolean {
  if (code.length === 0 || code.length > CODE_LIMIT || code !== code.trim()) return false;
  if (/[^\x21-\x7e]/u.test(code)) return false;
  const separator = code.indexOf("#");
  return separator > 0 && separator === code.lastIndexOf("#") && separator < code.length - 1;
}

export class SupersetSignIn {
  readonly #cli: SupersetCli;
  readonly #openExternal: (url: string) => Promise<unknown>;
  readonly #onChange: (snapshot: SupersetSignInSnapshot) => void;
  readonly #spawnLogin: NonNullable<SupersetSignInOptions["spawnLogin"]>;
  readonly #timeoutMs: number;
  #child: LoginChild | undefined;
  #authorizationUrl: string | undefined;
  #timeout: ReturnType<typeof setTimeout> | undefined;
  #attempt = 0;
  #starting = false;
  #state = snapshot(SUPERSET_SIGN_IN_STAGE.IDLE);

  constructor(options: SupersetSignInOptions) {
    this.#cli = options.cli;
    this.#openExternal = options.openExternal;
    this.#onChange = options.onChange;
    this.#spawnLogin =
      options.spawnLogin ??
      ((executable, arguments_) =>
        spawn(executable, [...arguments_], {
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        }));
    this.#timeoutMs = options.timeoutMs ?? SIGN_IN_TIMEOUT_MS;
  }

  current(): SupersetSignInSnapshot {
    return this.#state;
  }

  async begin(): Promise<SupersetSignInSnapshot> {
    if (this.#child || this.#starting) return this.#state;
    if (
      this.#state.stage !== SUPERSET_SIGN_IN_STAGE.IDLE &&
      this.#state.stage !== SUPERSET_SIGN_IN_STAGE.FAILURE
    ) {
      return this.#state;
    }
    this.#starting = true;
    const attempt = ++this.#attempt;
    if (!(await this.#cli.installed())) {
      this.#starting = false;
      if (attempt !== this.#attempt) return this.#state;
      return this.#fail("Superset is not available on this Mac.");
    }
    if (attempt !== this.#attempt) {
      this.#starting = false;
      return this.#state;
    }

    this.#authorizationUrl = undefined;
    this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.BROWSER_CODE));
    let child: LoginChild;
    try {
      child = this.#spawnLogin(this.#cli.executable, ["auth", "login", "--json"]);
    } catch {
      this.#starting = false;
      return this.#fail("Superset sign-in could not start.");
    }
    this.#child = child;
    this.#starting = false;
    let stdoutTail = "";
    let stderrTail = "";
    const inspect = (chunk: unknown, stream: "stdout" | "stderr") => {
      if (attempt !== this.#attempt || this.#authorizationUrl) return;
      const next = `${stream === "stdout" ? stdoutTail : stderrTail}${String(chunk)}`.slice(
        -OUTPUT_TAIL_LIMIT,
      );
      if (stream === "stdout") stdoutTail = next;
      else stderrTail = next;
      const found = authorizationUrl(next);
      if (!found) return;
      this.#authorizationUrl = found;
      void this.#openExternal(found);
    };
    child.stdout.on("data", (chunk) => inspect(chunk, "stdout"));
    child.stderr.on("data", (chunk) => inspect(chunk, "stderr"));
    child.stdin.on("error", () => {
      if (attempt === this.#attempt) this.#fail("Superset did not accept that sign-in code.");
    });
    child.once("error", () => {
      if (attempt === this.#attempt) this.#fail("Superset sign-in could not start.");
    });
    child.once("close", () => void this.#finish(attempt));
    this.#timeout = setTimeout(() => {
      if (attempt !== this.#attempt) return;
      this.#stopChild();
      this.#fail("Superset sign-in timed out. Try again when you’re ready.");
    }, this.#timeoutMs);
    return this.#state;
  }

  submitCode(code: string): SupersetSignInSnapshot {
    if (!this.#child || this.#state.stage !== SUPERSET_SIGN_IN_STAGE.BROWSER_CODE)
      return this.#state;
    if (!validSupersetSignInCode(code)) {
      return this.#fail("Paste the complete Superset code, including its # separator.");
    }
    try {
      this.#child.stdin.write(`${code}\r`);
    } catch {
      return this.#fail("Superset did not accept that sign-in code.");
    }
    this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.EXCHANGING));
    return this.#state;
  }

  reopen(): void {
    if (this.#authorizationUrl && this.#child) void this.#openExternal(this.#authorizationUrl);
  }

  cancel(): void {
    this.#attempt += 1;
    this.#starting = false;
    this.#stopChild();
    this.#authorizationUrl = undefined;
    this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.IDLE));
  }

  shutdown(): void {
    this.cancel();
  }

  async chooseOrganization(slug: string): Promise<SupersetSignInSnapshot> {
    if (this.#state.stage !== SUPERSET_SIGN_IN_STAGE.ORGANIZATION) return this.#state;
    const attempt = ++this.#attempt;
    this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.EXCHANGING));
    const connected = await this.#cli.chooseOrganization(slug);
    if (attempt !== this.#attempt) return this.#state;
    if (connected) {
      this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.CONNECTED));
    } else {
      this.#fail("Superset could not select that organization.");
    }
    return this.#state;
  }

  async #finish(attempt: number): Promise<void> {
    if (attempt !== this.#attempt) return;
    this.#clearChild();
    this.#starting = true;
    const connected = await this.#cli.connected();
    if (attempt !== this.#attempt) return;
    if (connected) {
      this.#starting = false;
      this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.CONNECTED));
      return;
    }
    const organizations = await this.#cli.organizations();
    if (attempt !== this.#attempt) return;
    this.#starting = false;
    if (organizations.length > 0) {
      this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.ORGANIZATION, { organizations }));
      return;
    }
    this.#fail("Superset sign-in did not finish.");
  }

  #fail(failure: string): SupersetSignInSnapshot {
    this.#attempt += 1;
    this.#starting = false;
    this.#stopChild();
    this.#authorizationUrl = undefined;
    this.#set(snapshot(SUPERSET_SIGN_IN_STAGE.FAILURE, { failure, organizations: [] }));
    return this.#state;
  }

  #set(next: SupersetSignInSnapshot): void {
    this.#state = next;
    this.#onChange(next);
  }

  #stopChild(): void {
    const child = this.#child;
    this.#clearChild();
    if (child) child.kill();
  }

  #clearChild(): void {
    if (this.#timeout) clearTimeout(this.#timeout);
    this.#timeout = undefined;
    this.#child = undefined;
  }
}

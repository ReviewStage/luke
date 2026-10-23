/**
 * later-worker.ts -- a worker handed over at once whose script lands later: what it is posted waits for the script, and what the started worker says is said by it.
 *
 * Pierre's pool asks its door for each worker synchronously
 * (`./highlight-pool.ts`), while the worker's script rides in a chunk of
 * its own that is fetched only once the pool starts
 * (`./highlight-worker-script.ts`), so the door hands back this stand-in
 * and starts the real worker once the script is at hand. Until then each
 * message posted is held, in order, and handed on as it was posted; a
 * script that never lands, or a start that throws, is told as the error a
 * worker failing to load is, so the pool falls back to the window's own
 * thread; and a stand-in terminated first never starts a worker at all.
 */

/** A message posted before the worker started, with what it transfers. */
interface Held {
  readonly message: unknown;
  readonly transfer: StructuredSerializeOptions | Transferable[] | undefined;
}

class LaterWorker extends EventTarget implements Worker {
  onmessage: Worker["onmessage"] = null;
  onmessageerror: Worker["onmessageerror"] = null;
  onerror: Worker["onerror"] = null;
  #started: Worker | undefined;
  #held: Held[] = [];
  #ended = false;

  constructor(script: Promise<string | undefined>, start: (script: string) => Worker) {
    super();
    script.then(
      (text) => this.#start(text, start),
      (error: unknown) => this.#fail(error),
    );
  }

  postMessage(message: unknown, transfer?: StructuredSerializeOptions | Transferable[]): void {
    if (this.#ended) return;
    if (this.#started === undefined) {
      this.#held.push({ message, transfer });
      return;
    }
    send(this.#started, { message, transfer });
  }

  terminate(): void {
    this.#ended = true;
    this.#held = [];
    this.#started?.terminate();
  }

  /** The worker started from the script, handed every message held for it; or the failure where there is no script. */
  #start(text: string | undefined, start: (script: string) => Worker): void {
    if (this.#ended) return;
    let worker: Worker;
    try {
      if (text === undefined) throw new Error("The build carried no highlight worker.");
      worker = start(text);
    } catch (error) {
      this.#fail(error);
      return;
    }
    worker.addEventListener("message", (event) => this.#retell(event));
    worker.addEventListener("messageerror", (event) => this.#retell(event));
    worker.addEventListener("error", (event) => {
      const told = new ErrorEvent("error", { message: event.message, cancelable: true });
      this.dispatchEvent(told);
      // Note that a failure the listener took as its own is not the window's either.
      if (told.defaultPrevented) event.preventDefault();
    });
    this.#started = worker;
    for (const held of this.#held) send(worker, held);
    this.#held = [];
  }

  /** A message or a message that could not be read, said by the stand-in as the worker said it. */
  #retell(event: MessageEvent): void {
    this.dispatchEvent(new MessageEvent(event.type, { data: event.data }));
  }

  /** The error a worker that fails to load raises, for a worker that never started. */
  #fail(error: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#held = [];
    const message = error instanceof Error ? error.message : String(error);
    this.dispatchEvent(new ErrorEvent("error", { message, cancelable: true }));
  }
}

/** One held message handed to the worker, with what it transfers. */
function send(worker: Worker, { message, transfer }: Held): void {
  if (Array.isArray(transfer)) worker.postMessage(message, transfer);
  else worker.postMessage(message, transfer);
}

/**
 * A worker that starts through `start` once `script` lands, standing in
 * for it until then; one whose script is undefined, or fails to land,
 * fails as a worker that cannot load does.
 */
export function laterWorker(
  script: Promise<string | undefined>,
  start: (script: string) => Worker,
): Worker {
  return new LaterWorker(script, start);
}

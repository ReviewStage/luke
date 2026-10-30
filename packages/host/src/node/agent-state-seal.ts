import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { open, realpath, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Effect } from "effect";
import { LocalAgentStateUnopened, LocalAgentStateUnsealed } from "../effect/seams.js";

/**
 * agent-state-seal.ts -- an agent's packed state sealed on its device before it leaves for Luke's store, and opened again once it comes back: AES-256-GCM under the agent's state key, streamed from the pack into a bundle in the device's own state, and from a bundle back into a pack.
 *
 * A bundle is one version byte (`AGENT_STATE_SEAL.VERSION`), a fresh nonce,
 * the pack encrypted, and GCM's tag, so a restore reads the nonce first and
 * takes nothing it decrypted until the tag checks. The key is the agent's,
 * 32 bytes the service answers in standard base64 with every save, the same
 * on each save of the agent's; it is handed in for the seal alone and never
 * written down. The pack stands in the agent's `tmp/`, a folder its VM
 * mounted and the agent could rig, so it is opened without following a
 * link, and refused unless it is a plain file whose folder is the one named
 * by its real path: a link the agent left there would otherwise seal a file
 * of the device's own into the agent's state. The bundle is written beside
 * its place and moved there whole. What it answers is the bundle's size and
 * SHA-256, which its commit names, and nothing of the pack's contents.
 *
 * A restore opens a bundle its device downloaded into its own state: its
 * size and SHA-256 are checked against the ones its save committed before a
 * byte of it is decrypted, and the pack is written beside its place in the
 * agent's `tmp/`, never through a link, and moved there only once GCM's tag
 * checks, so nothing of a bundle changed on its way is ever handed to a
 * restore.
 */

/** How a sealed bundle is laid out. */
const AGENT_STATE_SEAL = {
  /** The first byte of every bundle, which a restore refuses any other of. */
  VERSION: 1,
  CIPHER: "aes-256-gcm",
  KEY_BYTES: 32,
  NONCE_BYTES: 12,
  TAG_BYTES: 16,
} as const;

const unsealed = (detail: string) => new LocalAgentStateUnsealed({ detail });
const unopened = (detail: string) => new LocalAgentStateUnopened({ detail });

/** The bytes a bundle holds beside its encrypted pack: its version byte and nonce ahead of it, and GCM's tag after it. */
const SEAL_BYTES = 1 + AGENT_STATE_SEAL.NONCE_BYTES + AGENT_STATE_SEAL.TAG_BYTES;

/** The pack at `from` sealed under `key` into `to`, written beside it and moved over it: the bundle's size and SHA-256 in hex. */
async function sealed(
  input: {
    readonly from: string;
    readonly within: string;
    readonly to: string;
    readonly key: string;
  },
  signal: AbortSignal,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  const key = Buffer.from(input.key, "base64");
  if (key.length !== AGENT_STATE_SEAL.KEY_BYTES)
    throw unsealed("the agent's state key is not 32 bytes");
  if ((await realpath(dirname(input.from))) !== (await realpath(input.within))) {
    throw unsealed("the pack's folder is not the agent's own");
  }
  const pack = await open(input.from, constants.O_RDONLY | constants.O_NOFOLLOW);
  const writing = `${input.to}.writing`;
  try {
    if (!(await pack.stat()).isFile()) throw unsealed("the pack is not a plain file");
    const nonce = randomBytes(AGENT_STATE_SEAL.NONCE_BYTES);
    const cipher = createCipheriv(AGENT_STATE_SEAL.CIPHER, key, nonce, {
      authTagLength: AGENT_STATE_SEAL.TAG_BYTES,
    });
    const digest = createHash("sha256");
    let bytes = 0;
    await pipeline(
      pack.createReadStream(),
      cipher,
      async function* (encrypted: AsyncIterable<Buffer>) {
        const counted = (chunk: Buffer) => {
          digest.update(chunk);
          bytes += chunk.length;
          return chunk;
        };
        yield counted(Buffer.concat([Buffer.of(AGENT_STATE_SEAL.VERSION), nonce]));
        for await (const chunk of encrypted) yield counted(chunk);
        yield counted(cipher.getAuthTag());
      },
      createWriteStream(writing, { mode: 0o600 }),
      { signal },
    );
    await rename(writing, input.to);
    return { bytes, sha256: digest.digest("hex") };
  } catch (cause) {
    await rm(writing, { force: true });
    throw cause;
  } finally {
    await pack.close();
  }
}

/**
 * The pack at `from`, which must stand in the folder `within` by its real
 * path and be a plain file, sealed under the agent's key into `to`: the
 * bundle's size and digest. It fails, in words naming no path, the key, or
 * a byte of the pack, where it could not be.
 */
export const sealAgentState = (input: {
  readonly from: string;
  readonly within: string;
  readonly to: string;
  readonly key: string;
}) =>
  Effect.tryPromise({
    try: (signal) => sealed(input, signal),
    catch: (cause) =>
      cause instanceof LocalAgentStateUnsealed ? cause : unsealed("the pack could not be sealed"),
  });

/** The bundle at `from` checked against its committed size and digest, then opened under `key` into `to`, written beside it and moved over it. */
async function openedPack(
  input: {
    readonly from: string;
    readonly to: string;
    readonly within: string;
    readonly key: string;
    readonly bytes: number;
    readonly sha256: string;
  },
  signal: AbortSignal,
): Promise<void> {
  const key = Buffer.from(input.key, "base64");
  if (key.length !== AGENT_STATE_SEAL.KEY_BYTES)
    throw unopened("the agent's state key is not 32 bytes");
  if ((await realpath(dirname(input.to))) !== (await realpath(input.within))) {
    throw unopened("the pack's folder is not the agent's own");
  }
  const bundle = await open(input.from, constants.O_RDONLY | constants.O_NOFOLLOW);
  const writing = `${input.to}.writing`;
  try {
    const { size } = await bundle.stat();
    if (size !== input.bytes) {
      throw unopened(`its bundle holds ${size} bytes, not the ${input.bytes} its save committed`);
    }
    if (size < SEAL_BYTES) throw unopened("its bundle is too short to hold a pack");
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(input.from, { signal })) digest.update(chunk);
    if (digest.digest("hex") !== input.sha256) {
      throw unopened("its bundle's SHA-256 is not the one its save committed");
    }
    const head = Buffer.alloc(1 + AGENT_STATE_SEAL.NONCE_BYTES);
    const tag = Buffer.alloc(AGENT_STATE_SEAL.TAG_BYTES);
    await bundle.read(head, 0, head.length, 0);
    await bundle.read(tag, 0, tag.length, size - tag.length);
    if (head[0] !== AGENT_STATE_SEAL.VERSION) {
      throw unopened(`its bundle is not sealed as version ${AGENT_STATE_SEAL.VERSION}`);
    }
    const decipher = createDecipheriv(AGENT_STATE_SEAL.CIPHER, key, head.subarray(1), {
      authTagLength: AGENT_STATE_SEAL.TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    let authentic = true;
    decipher.once("error", () => {
      authentic = false;
    });
    // Note that whatever stands where the pack is written is taken away first, never written through, since the agent's `tmp/` is a folder its VM mounts.
    await rm(writing, { force: true });
    try {
      await pipeline(
        createReadStream(input.from, { start: head.length, end: size - tag.length - 1, signal }),
        decipher,
        createWriteStream(writing, { flags: "wx", mode: 0o600 }),
        { signal },
      );
    } catch (cause) {
      if (!authentic) throw unopened("its bundle did not open under the agent's state key");
      throw cause;
    }
    await rename(writing, input.to);
  } catch (cause) {
    await rm(writing, { force: true });
    throw cause;
  } finally {
    await bundle.close();
  }
}

/**
 * The bundle at `from`, as Luke's store answered it, checked against the
 * size and SHA-256 its save committed, then opened under the agent's key
 * into the pack at `to`, which must stand in the folder `within` by its
 * real path. It fails, in words naming no path, the key, or a byte of the
 * pack, where it could not be, and leaves no pack behind.
 */
export const openAgentState = (input: {
  readonly from: string;
  readonly to: string;
  readonly within: string;
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}) =>
  Effect.tryPromise({
    try: (signal) => openedPack(input, signal),
    catch: (cause) =>
      cause instanceof LocalAgentStateUnopened ? cause : unopened("its bundle could not be opened"),
  });

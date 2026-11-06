import { Schema as EffectSchema } from "effect";

/**
 * sandbox-tunnel-wire.ts -- a tunnel into a coding agent's sandbox: the socket the desktop's host opens to the service, the bridge it reaches, and the channel frames both ends speak on it.
 *
 * One socket is one bridge in one agent's running sandbox, picked by its
 * kind: a forwarded port today, whose bridge opens a TCP connection to
 * `127.0.0.1:<port>` in the sandbox for each channel the desktop opens. The
 * desktop opens the socket from its main process under the account's bearer
 * and with no `Origin`, as it opens a terminal, and the member must reach the
 * agent as for its Terminal. Nothing is exposed from the sandbox: the service
 * carries the socket over the sandbox's own PTY.
 *
 * Every frame is a JSON text frame naming a channel: `open` starts one,
 * `data` carries its bytes base64-encoded, and `close` ends it, with
 * `refused` as its reason where nothing listened on the port. Either side
 * may close a channel; the other side closes its end then and sends nothing
 * more on it. A frame the desktop sends refuses a key it did not name; one
 * the service sends is read dropping any key a newer service added. No byte
 * a channel carries is ever logged, traced, counted, or kept in a fixture
 * (root `AGENTS.md`'s Never, as for a Terminal's bytes).
 *
 * How the socket ended says what the desktop shows: the close codes below,
 * each a state of the tunnel rather than a failure.
 */

/** The socket's path, and the query naming the agent, the bridge's kind, and its argument. */
export const SANDBOX_TUNNEL = {
  PATH: "/api/terminal/tunnels",
  QUERY: { AGENT: "agent", KIND: "kind", PORT: "port" },
} as const;

/** The bridges a tunnel reaches, by kind. */
export const TUNNEL_KIND = {
  /** TCP connections to a port on the sandbox's loopback, one a channel. */
  PORT_FORWARD: "port-forward",
} as const;

export type TunnelKind = (typeof TUNNEL_KIND)[keyof typeof TUNNEL_KIND];

/** The ports a forward may name: none a service needs root to bind. */
export const FORWARD_PORT = { MIN: 1024, MAX: 65_535 } as const;

/** How the service ends a tunnel's socket, by what the desktop should show. */
export const TUNNEL_CLOSE = {
  /** No byte crossed the tunnel either way for the idle bound; the desktop opens it again on the next connection. */
  IDLE: 4000,
  /** The sandbox is not running, stopped or not opened yet; a tunnel never wakes it. */
  NOT_RUNNING: 4001,
  /** The agent was archived, or is no agent this account reaches. */
  GONE: 4003,
  /** Vercel could not be reached, or the bridge did not come up or ended; the desktop may try again. */
  UNAVAILABLE: 4005,
} as const;

/** A channel frame's type. */
export const TUNNEL_FRAME = {
  OPEN: "open",
  DATA: "data",
  CLOSE: "close",
} as const;

/** Why a channel closed, where it was not an ordinary end. */
export const TUNNEL_CLOSE_REASON = {
  /** Nothing listened on the port the bridge connects to. */
  REFUSED: "refused",
} as const;

/** A channel's id: the opener's own, unique among the socket's open channels. */
const channel = EffectSchema.Int.check(
  EffectSchema.isBetween({ minimum: 0, maximum: 2 ** 31 - 1 }),
);

/** One channel frame, as both ends send it. */
export const tunnelFrameSchema = EffectSchema.Union([
  EffectSchema.Struct({ type: EffectSchema.Literal(TUNNEL_FRAME.OPEN), channel }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TUNNEL_FRAME.DATA),
    channel,
    data: EffectSchema.Uint8ArrayFromBase64,
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(TUNNEL_FRAME.CLOSE),
    channel,
    reason: EffectSchema.optional(EffectSchema.Literals(Object.values(TUNNEL_CLOSE_REASON))),
  }),
]);

export type TunnelFrame = typeof tunnelFrameSchema.Type;

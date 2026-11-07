/**
 * send-traces.ts -- a send the developer pressed, traced by whatever traces the window, its trace handed to the host beside the act.
 *
 * An agent started (on a task, continued, or forked), a task started with
 * its agent, and a message sent or queued are each a span of the window's
 * Sentry SDK from the press until the host answers, run through the tracer
 * the shell installed: the desktop window's renderer SDK
 * (`apps/desktop/src/renderer/desktop-sentry-sdk.ts`) and the web tab's
 * browser SDK (`apps/web/src/app/web-sentry-sdk.ts`). The span's trace
 * crosses the act port with the act (`@repo/host/contract`'s
 * `ActPortCallContext`), so the hosted call the host makes for it carries
 * it on and the service's spans sit beneath it. A window with no tracer, a
 * test's or a shell that traces nothing, sends with no trace.
 *
 * Note that a span is named for its kind of send alone
 * (`SENTRY_SEND_SPAN`), and nothing of what was sent is set on it, so no
 * message, prompt, file, or name rides on it.
 */

import { SENTRY_SEND_OP, type SendTrace, type SentrySendSpan } from "@repo/features/sentry-tracing";

/** What a shell traces a send through: `send` run under a span named `name`, handed that span's trace, the span ending as it settles. */
export type SendTracer = <A>(
  name: SentrySendSpan,
  send: (trace: SendTrace | undefined) => Promise<A>,
) => Promise<A>;

/** The calls of a Sentry SDK a send is traced through, as `@sentry/electron/renderer` and `@sentry/browser` both export them. */
export interface SendTracingSdk {
  readonly startNewTrace: <T>(callback: () => T) => T;
  readonly startSpan: <T>(options: { name: string; op: string }, callback: () => T) => T;
  readonly getTraceData: () => { readonly "sentry-trace"?: string; readonly baggage?: string };
}

let tracer: SendTracer | undefined;

/**
 * A shell's tracer over its SDK, as Sentry's guide to custom trace
 * propagation has it: each send a span of a trace of its own, so it is
 * sampled as a send whatever page load or navigation stands, lasting until
 * its answer settles, and handed the span's `getTraceData` to carry on.
 */
export function sentrySendTracer(sdk: SendTracingSdk): SendTracer {
  return (name, send) =>
    sdk.startNewTrace(() =>
      sdk.startSpan({ name, op: SENTRY_SEND_OP }, () => {
        const { "sentry-trace": sentryTrace, baggage } = sdk.getTraceData();
        return send(
          sentryTrace === undefined
            ? undefined
            : { sentryTrace, ...(baggage === undefined ? undefined : { baggage }) },
        );
      }),
    );
}

/** Installs what this window traces its sends through, and answers what takes it back. */
export function installSendTracer(installed: SendTracer): () => void {
  tracer = installed;
  return () => {
    if (tracer === installed) tracer = undefined;
  };
}

/** A send run under the span `name` names, handed its trace; with no name, or no tracer, run untraced. */
export function tracedSend<A>(
  name: SentrySendSpan | undefined,
  send: (trace: SendTrace | undefined) => Promise<A>,
): Promise<A> {
  if (name === undefined || tracer === undefined) return send(undefined);
  return tracer(name, send);
}

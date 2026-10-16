/**
 * sentry-transport.ts -- Sentry as a suite stands it up: the deployment's error reports over a transport that writes down what it would have sent.
 *
 * Sentry's transport is the process boundary the reports cross, so a suite
 * replaces it and nothing else: the client, its redaction, and the logger
 * that files a line are the production ones. The runtime's close flushes the
 * client, so a suite reads what was sent once its layer is released.
 */

import type { Envelope, Event, SerializedCheckIn } from "@sentry/core";
import { ConfigProvider, Layer, Logger } from "effect";
import {
  ERROR_REPORTS_ENVIRONMENT,
  type ErrorReports,
  type ErrorReportsTransport,
  errorReportsLayer,
  errorReportsLogger,
} from "../observability/error-reports.js";

/** A DSN on a reserved domain, which the recording transport never posts to. */
export const FIXTURE_SENTRY_DSN = "https://public@sentry.invalid/1";

/** What Sentry would have received, in the order it was sent. */
interface SentToSentry {
  readonly events: Event[];
  readonly checkIns: SerializedCheckIn[];
}

/** A transport, and what it was handed to send. */
export interface RecordingSentryTransport {
  readonly sent: SentToSentry;
  readonly transport: ErrorReportsTransport;
}

/** A transport that keeps each envelope's events and check-ins rather than posting them. */
export function recordingSentryTransport(): RecordingSentryTransport {
  const sent: SentToSentry = { events: [], checkIns: [] };
  const transport: ErrorReportsTransport = () => ({
    send: (envelope: Envelope) => {
      for (const [header, payload] of envelope[1]) {
        if (header.type === "event") {
          // SAFETY: Sentry's envelope item header names its payload's shape.
          sent.events.push(payload as Event);
        }
        if (header.type === "check_in") {
          // SAFETY: as above, for a check-in.
          sent.checkIns.push(payload as SerializedCheckIn);
        }
      }
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });
  return { sent, transport };
}

/** The deployment's reports and the logger that files through them, on a deployment whose environment is `environment`. */
export function errorReportsOn(
  environment: Record<string, string>,
  transport: ErrorReportsTransport,
): Layer.Layer<ErrorReports> {
  const reports = Layer.orDie(errorReportsLayer(transport)).pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(environment))),
  );
  return Layer.provideMerge(Logger.layer([errorReportsLogger]), reports);
}

/** The reports on a deployment that names the fixture DSN and nothing else. */
export function reportingErrors(transport: ErrorReportsTransport): Layer.Layer<ErrorReports> {
  return errorReportsOn({ [ERROR_REPORTS_ENVIRONMENT.DSN]: FIXTURE_SENTRY_DSN }, transport);
}

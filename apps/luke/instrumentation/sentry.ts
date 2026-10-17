/**
 * sentry.ts -- Sentry for Luke's planning brain, as Sentry's eve guide sets it up: started before the agent loads, so every turn, model call, tool call, and error reaches Sentry's Agent Tracing.
 *
 * eve runs this provider's setup at server startup, before it loads the
 * agent and the AI SDK. The options are the deployment's own
 * (`@luke/service/observability/sentry`), so this root reports to the same
 * project, environment, and release as the web functions; its runtime
 * (`runtime.ts`) adds Effect's reporting over the client this starts.
 */

import { sentryOptions } from "@luke/service/observability/sentry";
import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";

export default defineInstrumentation(Sentry.eveInstrumentation(sentryOptions()));

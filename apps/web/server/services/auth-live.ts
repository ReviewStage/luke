import { Effect, Layer } from "effect";
import { auth } from "../auth.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../hosted/bearer.js";
import { HostedAuth } from "./tags.js";

export const HostedAuthLive = Layer.succeed(HostedAuth, {
  resolveUserId: (request) =>
    Effect.promise(() =>
      hostedUserId(request, async (input) =>
        oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
      ).catch(() => undefined),
    ),
});

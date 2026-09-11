import { getDatabase } from "../db/index.js";
import type { IntroductionMintSeams } from "../introduction-mint-app.js";
import { spendIntroductionMeter } from "./quota.js";

/**
 * The deployment's real seam behind the introduction's mint: its own shared
 * daily ceiling, and nothing else. It stands apart from the signed-in mints'
 * seams because those reach the vault and the hosted store, which the one
 * function a first run touches has no use for.
 */
export function hostedIntroductionMintSeams(): IntroductionMintSeams {
  return { spendIntroduction: () => spendIntroductionMeter(getDatabase(), { now: Date.now() }) };
}

/**
 * Runtime facts that travel beside, but never masquerade as, stored choices.
 *
 * They live apart from the schema on purpose: a setting's own entry says
 * whether its row is drawn, and it judges that from these — so a type derived
 * from the schema cannot be what the schema reads.
 */
export interface RuntimeStatus {
  voiceAvailable: boolean;
}

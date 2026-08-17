/** One tool call the model made, as it arrives inside a finished response. */
export interface RealtimeFunctionCall {
  name: string;
  callId: string;
  argumentsJson: string;
}

const NAMED_CREDENTIAL_PATTERN = /\w{0,64}(?:key|token|secret)"?\s*[=:]\s*"?[^\s&"']+/gi;

const CREDENTIAL_PATTERN =
  /sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|eyJ[A-Za-z0-9_.-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|[A-Za-z0-9+/=_-]{32,}/gi;

const REDACTED = "[redacted]";

export function redactCredentials(message: string): string {
  return message.replace(NAMED_CREDENTIAL_PATTERN, REDACTED).replace(CREDENTIAL_PATTERN, REDACTED);
}

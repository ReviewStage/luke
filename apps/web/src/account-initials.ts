/**
 * The signed-in account drawn as letters when it has no avatar image. The
 * provider's own name for the account is the first source; an account that
 * carries only an address falls back to the local part, which is all such an
 * account ever has to be named by.
 */
export function accountInitials(name: string, email: string): string | undefined {
  return initialsFrom(name) ?? initialsFrom(localPart(email));
}

const WORD_SEPARATOR = /[\s._+-]+/;

function localPart(email: string): string {
  return email.split("@")[0] ?? "";
}

function initialsFrom(source: string): string | undefined {
  const words = source.split(WORD_SEPARATOR).filter((word) => word.length > 0);
  const first = leadingCharacter(words[0]);
  if (first === undefined) return undefined;
  const last = words.length > 1 ? leadingCharacter(words[words.length - 1]) : undefined;
  return last === undefined ? first : `${first}${last}`;
}

function leadingCharacter(word: string | undefined): string | undefined {
  // Code points rather than UTF-16 units: a name opening on an astral
  // character would otherwise be cut in half at its surrogate pair.
  const character = word === undefined ? undefined : Array.from(word)[0];
  return character?.toLocaleUpperCase();
}

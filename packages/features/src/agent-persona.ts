/**
 * agent-persona.ts -- the human name each coding agent is given as it is
 * created, so the agents on a task read as a team of people in its chat,
 * its tabs, and the sidebar rather than as their titles.
 *
 * A name is a first name and a last name drawn from the lists below, and no
 * two agents on one task share a first name, so a teammate is told apart by
 * the name a person would call them. The name is stored on the agent's row
 * (`coding_agent.persona_name`) and kept when the agent is continued; an
 * agent from before names were given has none and is named as it was
 * (`agentTabLabel`).
 */

/** The first names an agent is given, varied and short enough for a tab. */
const FIRST_NAMES = [
  "Maya",
  "Leo",
  "Priya",
  "Sam",
  "Nora",
  "Theo",
  "Ava",
  "Jonah",
  "Iris",
  "Felix",
  "Zoe",
  "Omar",
  "Lena",
  "Kai",
  "Ruby",
  "Ezra",
  "Mila",
  "Hugo",
  "Tara",
  "Owen",
  "Nina",
  "Arjun",
  "Clara",
  "Milo",
  "Sofia",
  "Diego",
  "Hana",
  "Luca",
  "Elena",
  "Rafael",
  "June",
  "Ines",
  "Caleb",
  "Yara",
  "Max",
  "Lucy",
  "Dev",
  "Rosa",
  "Finn",
  "Aisha",
  "Ben",
  "Chloe",
  "Marco",
  "Freya",
  "Noah",
  "Sana",
  "Jack",
  "Vera",
  "Ali",
  "Grace",
] as const;

/** The last names an agent is given. */
const LAST_NAMES = [
  "Chen",
  "Patel",
  "Garcia",
  "Kim",
  "Okafor",
  "Novak",
  "Silva",
  "Cohen",
  "Nguyen",
  "Rossi",
  "Larsen",
  "Haddad",
  "Tanaka",
  "Murphy",
  "Ivanova",
  "Mendes",
  "Schmidt",
  "Park",
  "Ali",
  "Brooks",
  "Diaz",
  "Fischer",
  "Hughes",
  "Kowalski",
  "Lopez",
  "Moreau",
  "Nakamura",
  "Owens",
  "Reyes",
  "Singh",
] as const;

/** The first name of a full name: its words before the last. */
function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

/**
 * A human name for a new agent, by `random` (a number in [0, 1), as
 * `Math.random` answers): a first name none of `taken` (the names of the
 * task's other agents) begins with, while one is left, and any last name.
 */
export function pickPersonaName(taken: readonly string[], random: () => number): string {
  const used = new Set(taken.map(firstName));
  const free = FIRST_NAMES.filter((name) => !used.has(name));
  const firsts = free.length > 0 ? free : FIRST_NAMES;
  const first = firsts[Math.floor(random() * firsts.length)] ?? FIRST_NAMES[0];
  const last = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)] ?? LAST_NAMES[0];
  return `${first} ${last}`;
}

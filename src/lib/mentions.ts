// @mention parser. Accepts comment text and a directory of users; returns the
// set of matched user IDs. Matching tries (in order):
//   1) exact username (case-insensitive)
//   2) "first.last" compact form of users.name
//   3) "firstlast" compact form (no separator)
//
// Token grammar: `@` followed by word chars / dots / dashes / underscores.
// Stops on whitespace or punctuation other than `.`, `-`, `_`.

export type MentionableUser = {
  id: string;
  username?: string | null;
  name?: string | null;
  email?: string | null;
};

const TOKEN_RE = /@([a-zA-Z][a-zA-Z0-9._-]{0,40})/g;

function compactNames(name: string): string[] {
  const parts = name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return [];
  if (parts.length === 1) return [parts[0]];
  const first = parts[0];
  const last = parts[parts.length - 1];
  return [`${first}.${last}`, `${first}${last}`, first];
}

export function parseMentions(
  text: string,
  users: MentionableUser[],
): { userIds: string[]; tokens: string[] } {
  const byUsername = new Map<string, string>();
  const byCompactName = new Map<string, string>();
  for (const u of users) {
    if (u.username) byUsername.set(u.username.toLowerCase(), u.id);
    if (u.name) {
      for (const c of compactNames(u.name)) {
        if (!byCompactName.has(c)) byCompactName.set(c, u.id);
      }
    }
  }
  const matched = new Set<string>();
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const raw = m[1];
    const lower = raw.toLowerCase();
    tokens.push(raw);
    const hit = byUsername.get(lower) ?? byCompactName.get(lower);
    if (hit) matched.add(hit);
  }
  return { userIds: Array.from(matched), tokens };
}

/** A person tagged in a post or comment. Stored next to the text, never parsed back out of it. */
export interface MentionRef {
  uid: string;
  name: string;
}

export interface ActiveMention {
  /** Index of the "@" in the text. */
  start: number;
  /** What was typed after the "@" (can be empty). */
  query: string;
}

/** The "@..." being typed right before the caret, or null when there isn't one. */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // The "@" must start the text or follow whitespace (so emails don't trigger it).
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  // Names can have spaces, but stop suggesting after a line break or a long query.
  if (query.includes('\n') || query.length > 30) return null;
  return { start: at, query };
}

/** Replaces the "@query" with "@Name " and returns the new text and caret position. */
export function insertMention(
  text: string, m: ActiveMention, caret: number, name: string,
): { text: string; caret: number } {
  const insert = `@${name} `;
  return {
    text: text.slice(0, m.start) + insert + text.slice(caret),
    caret: m.start + insert.length,
  };
}

/** Keeps one entry per person and only those whose "@Name" is still in the text. */
export function pruneMentions(text: string, mentions: MentionRef[]): MentionRef[] {
  const seen = new Set<string>();
  return mentions.filter((m) => {
    if (seen.has(m.uid) || !text.includes('@' + m.name)) return false;
    seen.add(m.uid);
    return true;
  });
}

export interface TextSegment {
  text: string;
  /** Set when this piece is a mention. */
  uid?: string;
}

/** Splits text into plain pieces and mention pieces, for rendering. */
export function toSegments(text: string, mentions: MentionRef[] | undefined): TextSegment[] {
  if (!mentions?.length) return [{ text }];
  // Longest names first so "Ann Lee" wins over "Ann".
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length);
  const pattern = new RegExp(
    '@(' + sorted.map((m) => m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
    'g',
  );
  const byName = new Map(sorted.map((m) => [m.name, m.uid]));
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const i = match.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i) });
    out.push({ text: match[0], uid: byName.get(match[1]) });
    last = i + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

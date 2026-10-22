// descriptionOf is ported from teamrig's src/skills/lint.ts (and its test): teamrig is no package these tools can
// import, so the reader lives here too: change it there first, then here.

/**
 * Reads a skill file's YAML frontmatter the way Claude Code loads it: the block between the opening and closing
 * `---` lines, and its `description`, inline, quoted or as a `>` or `|` block scalar.
 */

/** The frontmatter between a skill file's opening `---` lines, without them; empty when the file has none. */
export function frontmatterOf(text: string): string {
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
}

/** The `description` of a skill's frontmatter as one line, or null when it has none or it is empty. */
export function descriptionOf(front: string): string | null {
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((line) => /^description\s*:/.test(line));
  if (at === -1) {
    return null;
  }
  const inline = (lines[at] ?? '').replace(/^description\s*:\s*/, '').trim();
  if (/^[>|][+-]?$/.test(inline)) {
    const block: string[] = [];
    for (const line of lines.slice(at + 1)) {
      if (!/^\s/.test(line)) {
        break;
      }
      block.push(line.trim());
    }
    const text = block.join(' ').trim();
    return text === '' ? null : text;
  }
  const text = inline.replace(/^(["'])(.*)\1$/, '$2').trim();
  return text === '' ? null : text;
}

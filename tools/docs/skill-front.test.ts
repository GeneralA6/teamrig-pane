import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { descriptionOf, frontmatterOf } from './skill-front.ts';

describe('frontmatterOf', () => {
  it('reads the block between the opening --- lines, with either line ending', () => {
    assert.equal(frontmatterOf('---\nname: x\ndescription: y\n---\n\n# X\n'), 'name: x\ndescription: y');
    assert.equal(frontmatterOf('---\r\nname: x\r\n---\r\n# X\r\n'), 'name: x');
  });

  it('is empty for a file with no frontmatter, or one not at the top', () => {
    assert.equal(frontmatterOf('# X\n'), '');
    assert.equal(frontmatterOf('# X\n---\nname: x\n---\n'), '');
  });
});

describe('descriptionOf', () => {
  it('reads inline, quoted and block descriptions', () => {
    assert.equal(descriptionOf('description: plain text'), 'plain text');
    assert.equal(descriptionOf('description: "quoted: text"'), 'quoted: text');
    assert.equal(descriptionOf("description: 'single'"), 'single');
    assert.equal(descriptionOf('description: >\n  folded\n  lines\nname: x'), 'folded lines');
    assert.equal(descriptionOf('name: x\r\ndescription: |\r\n  kept\r\n'), 'kept');
  });

  it('is null when the description is missing or empty', () => {
    assert.equal(descriptionOf('description: |-\n'), null);
    assert.equal(descriptionOf('description:'), null);
    assert.equal(descriptionOf('description: ""'), null);
    assert.equal(descriptionOf('name: x'), null);
  });
});

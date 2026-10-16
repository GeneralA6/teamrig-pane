import { describe, expect, test } from 'claude-code/testing'
import type { TaskRow } from '../types'
import { addressesIn, issueOf, issueUrl, MAX_ADDRESS_CHARS, MAX_LINKS, taskLinks } from '../hooks/links'

/** The fields taskLinks reads, none set. */
const BARE: Pick<TaskRow, 'source' | 'description' | 'ref' | 'note' | 'proof' | 'evidence'> = {
  source: 'owner',
  description: null,
  ref: null,
  note: null,
  proof: null,
  evidence: null,
}

describe('links', () => {
  test('a task teamrig opened from a GitHub issue links to that issue, its ref spelled as teamrig writes it', async () => {
    expect(issueUrl({ source: 'github', ref: 'gh:acme/app#12' })).toBe('https://github.com/acme/app/issues/12')
    expect(issueOf({ source: 'github', ref: 'gh:acme/app#12' })).toEqual({ repo: 'acme/app', number: 12 })
    expect(issueOf({ source: 'owner', ref: 'gh:acme/app#12' })).toBe(null)
    expect(issueUrl({ source: 'github', ref: ' gh:Acme-Co/app.js_2#7 ' })).toBe('https://github.com/Acme-Co/app.js_2/issues/7')
  })

  test('an odd ref, or the same ref on a task no issue opened, links to no issue', async () => {
    const odd = ['gh:acme#12', 'gh:acme/app#0', 'gh:acme/app#12x', 'gh:-acme/app#1', 'acme/app#12', 'gh:acme/app/x#1', 'gh:acme/app#12; docs/x.md:3', 'docs/x.md:3']
    expect(odd.map(ref => issueUrl({ source: 'github', ref }))).toEqual(odd.map(() => null))
    expect(issueUrl({ source: 'github', ref: null })).toBe(null)
    expect(issueUrl({ source: 'owner', ref: 'gh:acme/app#12' })).toBe(null)
  })

  test('finds each web address in a text, the punctuation that ends a sentence or closes a bracket or quote cut from its end', async () => {
    expect(addressesIn('merged in https://example.com/pr/7. Next: (https://example.com/a?b=1), "https://example.com/c";')).toEqual([
      'https://example.com/pr/7',
      'https://example.com/a?b=1',
      'https://example.com/c',
    ])
    expect(addressesIn("see [the run](HTTP://ci.example/run/9) and 'http://x.example:8080/y'")).toEqual(['HTTP://ci.example/run/9', 'http://x.example:8080/y'])
    expect(addressesIn('T12 waits on T4, no address here; ftp://example.com and https:// alone are none')).toEqual([])
  })

  test('leaves out an address longer than the engine draws as a link, counting each byte past ASCII as its percent-encoding', async () => {
    const at = (length: number) => `https://example.com/${'a'.repeat(length - 'https://example.com/'.length)}`
    expect(addressesIn(at(MAX_ADDRESS_CHARS))).toEqual([at(MAX_ADDRESS_CHARS)])
    expect(addressesIn(at(MAX_ADDRESS_CHARS + 1))).toEqual([])
    // é is two bytes, six characters encoded: 2040 ASCII characters and two of it are 2052.
    const accented = `${at(MAX_ADDRESS_CHARS - 8)}éé`
    expect(accented.length).toBeLessThan(MAX_ADDRESS_CHARS)
    expect(addressesIn(accented)).toEqual([])
  })

  test("a task's links: its issue first, then the addresses in its description, ref, note, proof and evidence, each once, at most MAX_LINKS", async () => {
    expect(taskLinks(BARE)).toEqual([])
    const task = {
      source: 'github',
      description: 'the spec: https://example.com/spec',
      ref: 'gh:acme/app#12',
      note: 'review at https://example.com/pr/7, same as https://example.com/pr/7. issue https://github.com/acme/app/issues/12',
      proof: 'the run at https://ci.example/run/8 passes',
      evidence: 'https://ci.example/run/9',
    }
    expect(taskLinks(task)).toEqual([
      'https://github.com/acme/app/issues/12',
      'https://example.com/spec',
      'https://example.com/pr/7',
      'https://ci.example/run/8',
      'https://ci.example/run/9',
    ])
    expect(taskLinks({ ...BARE, ref: 'docs/x.md:3; https://example.com/spec', evidence: 'abc123' })).toEqual(['https://example.com/spec'])
    const many = Array.from({ length: MAX_LINKS + 2 }, (_, i) => `https://example.com/${i}`)
    expect(taskLinks({ ...BARE, note: many.join(' ') })).toEqual(many.slice(0, MAX_LINKS))
  })
})

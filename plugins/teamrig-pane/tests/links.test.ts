import { describe, expect, test } from 'claude-code/testing'
import type { TaskRow } from '../types'
import { addressesIn, MAX_ADDRESS_CHARS, MAX_LINKS, pageOf, taskLinks } from '../hooks/links'

/** The fields taskLinks reads, none set. */
const BARE: Pick<TaskRow, 'item' | 'description' | 'ref' | 'note' | 'proof' | 'evidence'> = {
  item: null,
  description: null,
  ref: null,
  note: null,
  proof: null,
  evidence: null,
}

describe('links', () => {
  test("a ref's own spelling links nowhere: only the page teamrig served for its tracker item does", async () => {
    expect(taskLinks({ ...BARE, ref: 'gh:acme/app#12' })).toEqual([])
    expect(taskLinks({ ...BARE, ref: 'gh:acme/app#12', item: { tracker: 'GitHub', id: 'acme/app#12', url: null } })).toEqual([])
    expect(taskLinks({ ...BARE, ref: 'gh:acme/app#12', item: { tracker: 'GitHub', id: 'acme/app#12', url: 'https://github.com/acme/app/issues/12' } })).toEqual([
      'https://github.com/acme/app/issues/12',
    ])
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

  test('takes a served page only as an https address that is whole as a written one reads', async () => {
    expect(pageOf('https://tracker.example/items/12')).toBe('https://tracker.example/items/12')
    expect(pageOf(null)).toBe(null)
    const refused = ['http://tracker.example/items/12', 'javascript:alert(1)', 'https://', 'https://a.example/1 https://b.example/2', 'https://a.example/1.', ' https://a.example/1']
    expect(refused.map(pageOf)).toEqual(refused.map(() => null))
  })

  test("a task's links: its tracker item's page first, then the addresses in its description, ref, note, proof and evidence, each once, at most MAX_LINKS", async () => {
    expect(taskLinks(BARE)).toEqual([])
    const task = {
      item: { tracker: 'GitHub', id: 'acme/app#12', url: 'https://github.com/acme/app/issues/12' },
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

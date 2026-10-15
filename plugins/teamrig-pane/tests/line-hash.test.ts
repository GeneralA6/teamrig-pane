import { describe, expect, test } from 'claude-code/testing'
import { LINE_HASH_DIGITS, lineHash, sha256Hex, utf8Bytes } from '../hooks/line-hash'

describe('line hash', () => {
  test('is SHA-256: the FIPS 180-4 examples and the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  test('pads across the block edge: 55 bytes fit one block, 56 and 64 need a second', () => {
    expect(sha256Hex('a'.repeat(55))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318')
    expect(sha256Hex('a'.repeat(56))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a')
    expect(sha256Hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb')
  })

  test("gives teamrig's own lineHash vectors, so a mark's lastLineHash finds the same line", () => {
    expect(lineHash('')).toBe('e3b0c44298fc1c14')
    expect(lineHash('- a')).toBe('ae030a32f1f546fd')
    expect(lineHash('- 2030-01-07 09:00 lead: first')).toBe('03d55a9ff7564bab')
    expect(lineHash('é ünïcode 日本')).toBe('9ebc12f06fbcec7d')
    expect(lineHash('x')).toHaveLength(LINE_HASH_DIGITS)
  })

  test('hashes UTF-8 bytes: 2-, 3- and 4-byte characters, and a lone surrogate as U+FFFD the way node:crypto does', () => {
    expect([...utf8Bytes('aé日😀')]).toEqual([0x61, 0xc3, 0xa9, 0xe6, 0x97, 0xa5, 0xf0, 0x9f, 0x98, 0x80])
    expect([...utf8Bytes('\ud800')]).toEqual([0xef, 0xbf, 0xbd])
    expect(sha256Hex('emoji 😀 end')).toBe('503ab0f89cfe2ebe319922c847d66ae71ede4944d5ffdbff6434fd11af5fd050')
    expect(sha256Hex('lone \ud800 surrogate')).toBe('dc12673580894e234a7f878d6c2c065ca6a14fe3833c4545417dacb2e196fe2c')
  })
})

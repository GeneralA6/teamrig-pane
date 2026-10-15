// The inbox line hash teamrig's read marks carry (`lastLineHash`): the first 16 hex digits of the
// SHA-256 of the line's UTF-8 bytes. teamrig computes it with node:crypto, which a pane cannot load,
// so this is SHA-256 (FIPS 180-4) in plain TypeScript; tests/line-hash.test.ts pins it to the same
// vectors teamrig's own test uses, so both find the same last-read line.

/** The SHA-256 round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const ROUND_CONSTANTS: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

/** The initial hash: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const INITIAL_HASH: readonly number[] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]

/** How many hex digits of the digest a mark keeps. */
export const LINE_HASH_DIGITS = 16

/** The replacement character a lone surrogate encodes as, the way node:crypto and TextEncoder encode it. */
const REPLACEMENT = 0xfffd

function rotateRight(word: number, bits: number): number {
  return (word >>> bits) | (word << (32 - bits))
}

/** The text's UTF-8 bytes; a lone surrogate (half of a broken pair) becomes U+FFFD. */
export function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = []
  for (const char of text) {
    const point = char.codePointAt(0) ?? REPLACEMENT
    const code = point >= 0xd800 && point <= 0xdfff ? REPLACEMENT : point
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return Uint8Array.from(bytes)
}

/** The message padded to whole 64-byte blocks: a 1 bit, zeros, then its length in bits as a big-endian 64-bit number. */
function padded(bytes: Uint8Array): DataView {
  const blocks = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  blocks.set(bytes)
  blocks[bytes.length] = 0x80
  const view = new DataView(blocks.buffer)
  const bits = bytes.length * 8
  view.setUint32(blocks.length - 8, Math.floor(bits / 2 ** 32))
  view.setUint32(blocks.length - 4, bits >>> 0)
  return view
}

/** The SHA-256 digest of a string's UTF-8 bytes, as 64 lowercase hex digits. */
export function sha256Hex(text: string): string {
  const message = padded(utf8Bytes(text))
  const hash = new DataView(new ArrayBuffer(32))
  INITIAL_HASH.forEach((word, i) => hash.setUint32(i * 4, word))
  const schedule = new DataView(new ArrayBuffer(256))
  for (let offset = 0; offset < message.byteLength; offset += 64) {
    for (let t = 0; t < 16; t++) schedule.setUint32(t * 4, message.getUint32(offset + t * 4))
    for (let t = 16; t < 64; t++) {
      const w15 = schedule.getUint32((t - 15) * 4)
      const w2 = schedule.getUint32((t - 2) * 4)
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3)
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10)
      schedule.setUint32(t * 4, schedule.getUint32((t - 16) * 4) + s0 + schedule.getUint32((t - 7) * 4) + s1)
    }
    let a = hash.getUint32(0)
    let b = hash.getUint32(4)
    let c = hash.getUint32(8)
    let d = hash.getUint32(12)
    let e = hash.getUint32(16)
    let f = hash.getUint32(20)
    let g = hash.getUint32(24)
    let h = hash.getUint32(28)
    for (const [t, k] of ROUND_CONSTANTS.entries()) {
      const e1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const t1 = (h + e1 + choice + k + schedule.getUint32(t * 4)) >>> 0
      const a0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (a0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    for (const [i, word] of [a, b, c, d, e, f, g, h].entries()) hash.setUint32(i * 4, hash.getUint32(i * 4) + word)
  }
  return [0, 1, 2, 3, 4, 5, 6, 7].map(i => hash.getUint32(i * 4).toString(16).padStart(8, '0')).join('')
}

/** An inbox line's fingerprint as teamrig's `lineHash` writes it into a read mark. */
export function lineHash(line: string): string {
  return sha256Hex(line).slice(0, LINE_HASH_DIGITS)
}

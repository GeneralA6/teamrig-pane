// Where the docked body's window stands: the steps that move it, and how a drawing settles each on its body.
import { describe, expect, test } from 'claude-code/testing'
import { AT_TOP, scrolledTo, settle } from '../hooks/body-scroll'
import { placesOf, viewOf } from '../hooks/frame'
import type { Drawn } from '../hooks/layout'

/** `count` one-line elements keyed `<prefix><i>`. */
function lines(count: number, prefix = 'r'): Drawn[] {
  return Array.from({ length: count }, (_, i): Drawn => ({ key: `${prefix}${i}`, spans: [{ text: `row ${i}` }], wrap: 'wrap', toggle: null }))
}

// Twenty one-line elements, a row between two: element i at row 2i, 39 rows. A window of 10 rows at row 4.
const PLACES = placesOf(lines(20), 1)
const LAST = viewOf(PLACES, 4, 10)

describe('body-scroll', () => {
  test('each step counts one more', () => {
    expect(scrolledTo(AT_TOP, { kind: 'end' })).toEqual({ seq: 1, to: { kind: 'end' } })
  })

  test("an offset is taken as asked, the end as the body's last, and neither holds a reveal", () => {
    expect(settle(scrolledTo(AT_TOP, { kind: 'offset', offset: 7 }), null, PLACES, LAST)).toEqual({ offset: 7, settled: null })
    expect(settle(scrolledTo(AT_TOP, { kind: 'end' }), { seq: 0, offset: 3 }, PLACES, LAST)).toEqual({ offset: 29, settled: null })
  })

  test('a reveal lands its target where it asks, from where the window stood', () => {
    const centred = scrolledTo(AT_TOP, { kind: 'reveal', key: 'r10', block: 'center' })
    // r10 at row 20, its row at the window's middle: 20 - floor((10 - 1) / 2).
    expect(settle(centred, null, PLACES, LAST)).toEqual({ offset: 16, settled: { seq: 1, offset: 16 } })
    // r3 at row 6 shows in rows 4 to 13 already.
    expect(settle(scrolledTo(centred, { kind: 'reveal', key: 'r3', block: 'nearest' }), null, PLACES, LAST).offset).toBe(4)
  })

  test('a reveal settled once holds its offset as the body changes, until a new step', () => {
    const scroll = scrolledTo(AT_TOP, { kind: 'reveal', key: 'r10', block: 'start' })
    const first = settle(scroll, null, PLACES, LAST)
    expect(first.offset).toBe(20)
    // An element drawn above moves r10 two rows down.
    const grown = placesOf([...lines(1, 'new'), ...lines(20)], 1)
    expect(settle(scroll, first.settled, grown, viewOf(grown, first.offset, 10)).offset).toBe(20)
    expect(settle(scrolledTo(scroll, { kind: 'reveal', key: 'r10', block: 'start' }), first.settled, grown, viewOf(grown, 20, 10)).offset).toBe(22)
  })

  test('a reveal of a key the body does not hold yet lands at the top unsettled, and on its target once a drawing holds it', () => {
    const scroll = scrolledTo(AT_TOP, { kind: 'reveal', key: 'late0', block: 'start' })
    expect(settle(scroll, null, PLACES, LAST)).toEqual({ offset: 0, settled: null })
    // The element arrives at the body's end, row 40.
    const arrived = placesOf([...lines(20), ...lines(1, 'late')], 1)
    expect(settle(scroll, null, arrived, viewOf(arrived, 0, 10))).toEqual({ offset: 31, settled: { seq: 1, offset: 31 } })
  })
})

// The dock's colors: each tone the rows wear has the engine's theme key it draws in.
import { describe, expect, test } from 'claude-code/testing'
import { THEME, themeOf } from '../hooks/theme'
import { TONES } from '../hooks/tone'

describe('theme', () => {
  test('every tone has a theme key, and the map names no tone the rows cannot wear', () => {
    expect(Object.keys(THEME).sort()).toEqual([...TONES].sort())
  })

  test('the accent draws in the claude color, every other tone in the key of its own name', () => {
    expect(TONES.map(tone => themeOf(tone))).toEqual(['warning', 'error', 'success', 'suggestion', 'subtle', 'claude'])
  })

  test('a span with no tone takes no theme key, so it draws in the text color', () => {
    expect(themeOf(undefined)).toBeUndefined()
  })
})

// The pane's size: what the person's close does instead of closing, and how it is kept.
import { describe, expect, test } from 'claude-code/testing'
import type { PaneSize } from '../types'
import { PaneSizer, storedSize, type SizePorts } from '../hooks/size'

/** Ports over a kept value; `failing` names the ports that reject. */
function ports(kept: unknown, failing: readonly (keyof SizePorts)[] = []) {
  const shown: PaneSize[] = []
  const saved: PaneSize[] = []
  const fail = (port: keyof SizePorts) => (failing.includes(port) ? Promise.reject(new Error(`${port} failed`)) : null)
  const sizePorts: SizePorts = {
    load: () => fail('load') ?? Promise.resolve(kept),
    save: size => fail('save') ?? Promise.resolve(void saved.push(size)),
    show: size => fail('show') ?? Promise.resolve(void shown.push(size)),
  }
  return { shown, saved, sizePorts }
}

describe('size', () => {
  test('a kept size reads back; nothing kept or anything else is open', () => {
    expect(storedSize('minimized')).toBe('minimized')
    expect(storedSize('open')).toBe('open')
    expect(storedSize(undefined)).toBe('open')
    expect(storedSize({ size: 'minimized' })).toBe('open')
  })

  test('restores the kept size, open when the store cannot be read, and answers it though it cannot be drawn', async () => {
    const kept = ports('minimized')
    expect(await new PaneSizer(kept.sizePorts).restore()).toBe('minimized')
    expect(kept.shown).toEqual(['minimized'])

    const unreadable = ports('minimized', ['load'])
    expect(await new PaneSizer(unreadable.sizePorts).restore()).toBe('open')
    expect(unreadable.shown).toEqual(['open'])

    const undrawn = ports('minimized', ['show'])
    expect(await new PaneSizer(undrawn.sizePorts).restore()).toBe('minimized')
    expect(undrawn.shown).toEqual([])
  })

  test("the person's close is refused and minimizes the pane; the plugin's own close and an unload go through", async () => {
    const { shown, saved, sizePorts } = ports(undefined)
    const sizer = new PaneSizer(sizePorts)

    expect(await sizer.refusesClose({ kind: 'plugin' })).toBe(false)
    expect(await sizer.refusesClose({ kind: 'unload' })).toBe(false)
    expect(shown).toEqual([])
    expect(await sizer.refusesClose({ kind: 'person' })).toBe(true)
    expect(shown).toEqual(['minimized'])
    expect(saved).toEqual(['minimized'])
  })

  test('a failed draw or save never rejects, so the close is still refused', async () => {
    const { saved, sizePorts } = ports(undefined, ['show'])
    expect(await new PaneSizer(sizePorts).refusesClose({ kind: 'person' })).toBe(true)
    expect(saved).toEqual(['minimized'])

    const unsaved = ports(undefined, ['save'])
    expect(await new PaneSizer(unsaved.sizePorts).refusesClose({ kind: 'person' })).toBe(true)
    expect(unsaved.shown).toEqual(['minimized'])
  })
})

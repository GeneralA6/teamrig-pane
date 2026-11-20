// The pane's state behind its port: what a store kept in memory reads and writes.
import { describe, expect, test } from 'claude-code/testing'
import { EMPTY_SNAPSHOT, INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore, type PaneStore } from '../hooks/pane-store'

/** A step written against the port alone, as the pane's steps are: one more key folded away. */
async function fold(store: PaneStore, key: string): Promise<readonly string[]> {
  return store.update('tasksFolded', current => [...current, key])
}

describe('pane-store', () => {
  test('a new store reads each key as the state it was given holds it', async () => {
    const store = new MemoryStore(INITIAL_STATE)
    expect(await store.read('mode')).toBe('mine')
    expect(await store.read('snapshot')).toBe(EMPTY_SNAPSHOT)
    expect(store.state).toBe(INITIAL_STATE)
  })

  test('an update resolves to the value it wrote, and a read then finds it', async () => {
    const store = new MemoryStore(INITIAL_STATE)
    expect(await store.update('mode', () => 'all')).toBe('all')
    expect(await store.read('mode')).toBe('all')
  })

  test('an update runs on the value as last written, so no step before it is lost', async () => {
    const store = new MemoryStore(INITIAL_STATE)
    await fold(store, 'next')
    expect(await fold(store, 'owner:tr-ui')).toEqual(['next', 'owner:tr-ui'])
    expect(await store.read('tasksFolded')).toEqual(['next', 'owner:tr-ui'])
  })

  test('an update writes its key alone and leaves the state it started from as it was', async () => {
    const store = new MemoryStore(INITIAL_STATE)
    await store.update('view', () => 'team')
    expect(store.state).toEqual({ ...INITIAL_STATE, view: 'team' })
    expect(INITIAL_STATE.view).toBe('tasks')
  })

  test('two stores from the same start never share a write', async () => {
    const first = new MemoryStore(INITIAL_STATE)
    const second = new MemoryStore(INITIAL_STATE)
    await first.update('banner', () => true)
    expect(await second.read('banner')).toBe(false)
  })
})

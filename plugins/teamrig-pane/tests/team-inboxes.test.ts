// The own team's unread inbox lines (hooks/team-inboxes.ts): each session that marked its inbox read, counted after its
// newest mark, one that never did none; each file re-read only when its stamp moves.
import { describe, expect, test } from 'claude-code/testing'
import { TeamInboxes, type InboxPaths } from '../hooks/team-inboxes'
import { MemoryFiles, NOW, S1, S2, markLine } from './fixtures'

const PATHS: InboxPaths = { marks: 'K/tasks/inbox-marks.jsonl', inboxDir: 'K/inbox' }
const API_INBOX = `${PATHS.inboxDir}/api.md`
const LEAD_INBOX = `${PATHS.inboxDir}/lead.md`
const API_READ = 'lead: add the route'
const LEAD_READ = 'web: the page is up'

/** api read the first of its three lines, lead its one line; ui never marked its inbox read. */
function inboxDisk(): MemoryFiles {
  const disk = new MemoryFiles()
  disk.write(PATHS.marks, `${markLine('api', 1, S1, NOW, API_READ)}\n${markLine('lead', 1, S2, NOW, LEAD_READ)}\n`)
  disk.write(API_INBOX, `${API_READ}\nweb: the page needs it\nlead: by noon\n`)
  disk.write(LEAD_INBOX, `${LEAD_READ}\n`)
  disk.write(`${PATHS.inboxDir}/ui.md`, 'lead: start the page\n')
  return disk
}

/** The message `run` rejects with. */
async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'no failure'
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('TeamInboxes', () => {
  test("counts each marked session's lines after its newest mark; one that never marked has no count and is never read", async () => {
    const disk = inboxDisk()
    const inboxes = new TeamInboxes(disk, PATHS)
    expect([...(await inboxes.unread(['lead', 'api', 'ui']))]).toEqual([
      ['lead', 0],
      ['api', 2],
    ])
    expect(disk.reads).toEqual([PATHS.marks, LEAD_INBOX, API_INBOX])
  })

  test('a count again reads only the files whose stamp moved: a new line, a new mark', async () => {
    const disk = inboxDisk()
    const inboxes = new TeamInboxes(disk, PATHS)
    await inboxes.unread(['lead', 'api'])
    disk.reads.length = 0
    await inboxes.unread(['lead', 'api'])
    expect(disk.reads).toEqual([])

    disk.write(API_INBOX, `${API_READ}\nweb: the page needs it\nlead: by noon\nops: and a test\n`)
    expect((await inboxes.unread(['lead', 'api'])).get('api')).toBe(3)
    expect(disk.reads).toEqual([API_INBOX])

    disk.reads.length = 0
    disk.write(PATHS.marks, `${markLine('api', 4, S1, NOW, 'ops: and a test')}\n${markLine('lead', 1, S2, NOW, LEAD_READ)}\n`)
    expect((await inboxes.unread(['lead', 'api'])).get('api')).toBe(0)
    expect(disk.reads).toEqual([PATHS.marks])
  })

  test('a session no longer counted is dropped, and read anew when it is counted again', async () => {
    const disk = inboxDisk()
    const inboxes = new TeamInboxes(disk, PATHS)
    await inboxes.unread(['api'])
    await inboxes.unread(['lead'])
    disk.reads.length = 0
    expect([...(await inboxes.unread(['api']))]).toEqual([['api', 2]])
    expect(disk.reads).toEqual([API_INBOX])
  })

  test('a read that fails throws, and the next count reads it again', async () => {
    const disk = inboxDisk()
    const inboxes = new TeamInboxes(disk, PATHS)
    disk.failNextRead = 'EBUSY: resource busy or locked'
    expect(await failure(() => inboxes.unread(['api']))).toBe('EBUSY: resource busy or locked')
    expect([...(await inboxes.unread(['api']))]).toEqual([['api', 2]])
  })
})

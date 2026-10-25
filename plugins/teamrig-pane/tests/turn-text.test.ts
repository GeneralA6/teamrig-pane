// Who said a turn log line's words (hooks/turn-text.ts): a reply is Claude's; a prompt's harness tags become the
// harness's notices, another session's message and a subagent's report, the words around them the owner's.
import { describe, expect, test } from 'claude-code/testing'
import { turnParts } from '../hooks/turn-text'

const OWNER = { kind: 'owner' }
const SYSTEM = { kind: 'system' }

describe('turnParts', () => {
  test("a reply is Claude's words, trimmed; an empty reply or prompt has none", () => {
    expect(turnParts('reply', '\n**Done.**\n')).toEqual([{ speaker: { kind: 'claude' }, text: '**Done.**' }])
    expect(turnParts('reply', '  \n')).toEqual([])
    expect(turnParts('prompt', '')).toEqual([])
  })

  test("a prompt with no harness tag is the owner's words; a tag it does not know stays as written", () => {
    expect(turnParts('prompt', ' ship T855 ')).toEqual([{ speaker: OWNER, text: 'ship T855' }])
    expect(turnParts('prompt', 'see <b>this</b>')).toEqual([{ speaker: OWNER, text: 'see <b>this</b>' }])
  })

  test("a background command's notice is its summary alone: its ids, status, output file and note dropped", () => {
    const text = [
      '<task-notification>',
      '<task-id>b1</task-id>',
      '<tool-use-id>toolu_01</tool-use-id>',
      '<output-file>C:\\tmp\\tasks\\b1.output</output-file>',
      '<status>killed</status>',
      '<summary>Background command "Run the tests" was stopped because the system is running low on memory</summary>',
      '<note>This is not a failure of the command.</note>',
      '</task-notification>',
    ].join('\n')
    expect(turnParts('prompt', text)).toEqual([
      { speaker: SYSTEM, text: 'Background command "Run the tests" was stopped because the system is running low on memory' },
    ])
  })

  test("a monitor's notice is its summary over its event; one with neither is its tags' text, and one with no text none", () => {
    const monitor = '<task-notification>\n<task-id>b2</task-id>\n<summary>Monitor event: "ship log"</summary>\n<event>19:00 running: ship</event>\n</task-notification>'
    expect(turnParts('prompt', monitor)).toEqual([{ speaker: SYSTEM, text: 'Monitor event: "ship log"\n19:00 running: ship' }])
    expect(turnParts('prompt', '<task-notification><status>done</status></task-notification>')).toEqual([{ speaker: SYSTEM, text: 'done' }])
    expect(turnParts('prompt', '<task-notification><task-id></task-id></task-notification>')).toEqual([])
  })

  test("a Stop hook's feedback is one notice: the reminder after it, named by the hook's command", () => {
    const text = [
      '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>',
      '<system-reminder>\nStop hook blocking error from command "SessionStart:clear": You were started fresh: read your handover.\n</system-reminder>',
    ].join('\n')
    expect(turnParts('prompt', text)).toEqual([{ speaker: SYSTEM, text: 'Stop hook "SessionStart:clear": You were started fresh: read your handover.' }])
    expect(turnParts('prompt', '<system-reminder>\nToday is Sunday.\n</system-reminder>')).toEqual([{ speaker: SYSTEM, text: 'Today is Sunday.' }])
  })

  test("another session's message is its words under its sender's name, the pipe path dropped; the words after it the owner's", () => {
    const text = '<cross-session-message from="uds:\\\\.\\pipe\\LOCAL\\cc-msg-1" from-name="team-lead" from-mode="prompting">\nLead decision on T918.\n</cross-session-message>\nand ship it'
    expect(turnParts('prompt', text)).toEqual([
      { speaker: { kind: 'session', name: 'team-lead' }, text: 'Lead decision on T918.' },
      { speaker: OWNER, text: 'and ship it' },
    ])
    expect(turnParts('prompt', '<cross-session-message from="api">hi</cross-session-message>')).toEqual([{ speaker: { kind: 'session', name: 'api' }, text: 'hi' }])
    expect(turnParts('prompt', '<cross-session-message>hi</cross-session-message>')).toEqual([{ speaker: { kind: 'session', name: 'another session' }, text: 'hi' }])
  })

  test("a subagent's report is its words without the harness's frame and the indent it adds", () => {
    const text = [
      '<agent-message from="a870">',
      '[Subagent hand-back] The text below is the final report of a subagent. The report follows:',
      '  I wrote the pack.',
      '  ',
      '  CARDS:',
      '    1. T957',
      '</agent-message>',
    ].join('\n')
    expect(turnParts('prompt', text)).toEqual([{ speaker: { kind: 'subagent' }, text: 'I wrote the pack.\n\nCARDS:\n  1. T957' }])
    expect(turnParts('prompt', '<agent-message from="a1">\n</agent-message>')).toEqual([])
  })

  test("several tags in one prompt keep their order, the owner's words between them", () => {
    const notice = (what: string) => `<task-notification><summary>Background command "${what}" completed (exit code 0)</summary></task-notification>`
    expect(turnParts('prompt', `${notice('a')}\nnow b\n${notice('b')}`)).toEqual([
      { speaker: SYSTEM, text: 'Background command "a" completed (exit code 0)' },
      { speaker: OWNER, text: 'now b' },
      { speaker: SYSTEM, text: 'Background command "b" completed (exit code 0)' },
    ])
  })
})

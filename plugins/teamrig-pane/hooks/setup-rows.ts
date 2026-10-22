// The tasks view in a project teamrig is not set up for (setup.ts): what is missing, the problem the last look
// found, then the ways to set the project up, each a step of its own: install teamrig while no team is on the
// machine, make a team here, tie the project to a team already made, or name a register outside teamrig. The
// pane picks the register up once a step is done (setup.ts), which the last line says.
import { TEAM_POINTER } from './places'
import { single, type Block, type Span } from './rows'
import type { SetupView } from '../types'

/** teamrig's marketplace and plugin, as its README installs them. */
export const INSTALL_LINES = ['claude plugin marketplace add GeneralA6/teamrig', 'claude plugin install teamrig@teamrig'] as const

/** Where a step's wrapped lines go on: past its number. */
const STEP_HANG: Span = { text: '   ' }

/** Text to type or a path to write, in the theme's suggestion color. */
const code = (text: string): Span => ({ text, color: 'suggestion' })

/** A numbered step: its number dim, its spans after it. */
function step(key: string, at: number, spans: Span[]): Block {
  return single(`setup-${key}`, [{ text: `${at}. `, dim: true }, ...spans], STEP_HANG)
}

export function setupBlocks(view: SetupView): Block[] {
  const { project, teams, settingsPath } = view.setup
  const steps: Array<{ key: string; spans: Span[] }> = []
  if (teams.length === 0) {
    steps.push({ key: 'install', spans: [{ text: 'Install teamrig, if it is not: ' }, code(INSTALL_LINES[0]), { text: ', then ' }, code(INSTALL_LINES[1]), { text: '.' }] })
  }
  steps.push({
    key: 'team',
    spans: [
      { text: 'New team: ask Claude here to set up a team for the work, or run ' },
      code('/teamrig:team-setup'),
      { text: '. It proposes the sessions, then makes the team and ties this project to it.' },
    ],
  })
  if (teams.length > 0) {
    steps.push({
      key: 'join',
      spans: [
        { text: 'Join a team: write ' },
        code('{"team": "<id>"}'),
        { text: ' to ' },
        code(`${project}/${TEAM_POINTER}`),
        { text: `. Teams on this machine: ${teams.join(', ')}.` },
      ],
    })
  }
  steps.push({
    key: 'pane',
    spans: [{ text: 'Tasks kept outside teamrig: name ' }, code('tasksDir'), { text: ' and ' }, code('inboxDir'), { text: ' in ' }, code(settingsPath), { text: '.' }],
  })
  const problem = view.problem === null ? [] : [single('setup-problem', [{ text: `WARN ${view.problem}`, color: 'warning' }], { text: '  ' })]
  return [
    single('setup-head', [{ text: 'teamrig is not set up for this project', bold: true }]),
    single('setup-why', [{ text: `No ${TEAM_POINTER} in ${project} or a folder above it, and no team named by $TEAMRIG_TEAM.`, dim: true }]),
    ...problem,
    ...steps.map((each, i) => step(each.key, i + 1, each.spans)),
    single('setup-after', [{ text: 'The pane looks again every few seconds and lists the tasks once a team is found.', dim: true }]),
  ]
}

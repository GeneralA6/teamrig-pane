// The dedicated UI's entry, the file `node` runs: it hands the process's own streams and signals to the program
// (program.ts) and sets the exit code it answers. It has no team to read yet: it draws the empty pane, on a store
// kept in memory. Nothing is exported and nothing else lives here, since loading this file takes the terminal.
import process from 'node:process'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { FAILED_CODE, NO_TEAM_FRONT, ownLook, runProgram } from './program'

runProgram({
  input: process.stdin,
  output: process.stdout,
  signals: process,
  store: new MemoryStore(INITIAL_STATE),
  front: () => NO_TEAM_FRONT,
  look: ownLook(),
  complain: text => {
    process.stderr.write(`${text}\n`)
  },
}).then(
  code => {
    process.exitCode = code
  },
  (error: unknown) => {
    // The terminal could not be taken at all: nothing was drawn, so the reason can be said at once.
    process.stderr.write(`teamrig ui: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = FAILED_CODE
  },
)

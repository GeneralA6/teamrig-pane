// Preloaded (node --import) into each teamrig CLI run of a capture (golden.ts): fixes Date.now at the instant
// $GOLDEN_CLOCK_MS names, so the stamps teamrig writes and the times it prints are the same on every capture.
// golden.ts refuses a teamrig whose source reads the clock any other way (golden-format.ts realClockReads).
import { clockAt, GOLDEN_CLOCK_VARIABLE } from './golden-format.ts'

const at = clockAt(process.env[GOLDEN_CLOCK_VARIABLE])
Date.now = () => at

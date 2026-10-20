import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GOLDEN_CLOCK_VARIABLE } from '../../plugins/teamrig-pane/scripts/golden-format.ts';

/**
 * The pane's golden capture preloads scripts/golden-clock.ts (node --import) into each teamrig CLI run. It acts only
 * when imported, so its test imports it at run time, which `claude plugin test` refuses in a plugin test file: the
 * test lives here, under node alone, and the coverage run still measures the script it loads.
 */

const PRELOAD = new URL('../../plugins/teamrig-pane/scripts/golden-clock.ts', import.meta.url).href;
const AT = 1_792_235_559_957;

describe('the golden capture clock preload', () => {
  it("fixes the Date clock at the instant the run's variable names", async () => {
    const RealDate = globalThis.Date;
    const realNow = RealDate.now;
    const saved = process.env[GOLDEN_CLOCK_VARIABLE];
    process.env[GOLDEN_CLOCK_VARIABLE] = String(AT);
    try {
      await import(PRELOAD);
      assert.deepEqual([Date.now(), new Date().getTime()], [AT, AT]);
    } finally {
      globalThis.Date = RealDate;
      RealDate.now = realNow;
      if (saved === undefined) delete process.env[GOLDEN_CLOCK_VARIABLE];
      else process.env[GOLDEN_CLOCK_VARIABLE] = saved;
    }
  });
});

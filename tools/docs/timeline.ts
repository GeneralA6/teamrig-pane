/**
 * One CSS animation clock for a drawn picture, as teamrig's README pictures use it. Every moving part gets a class
 * (`a0`, `a1`, ...) whose keyframes sit on the same loop, so the parts stay in step without any script. Each class's
 * own style (outside its animation) is the part's state at the clock's `rest` moment, so with motion turned off
 * (`animation:none`) the picture is a still of that moment. The one motion here is `show`: fade in, hold, fade out.
 */

export interface Clock {
  /** The loop's length, in seconds. */
  readonly loop: number;
  /** When a part shown "to the end" hides again, so the loop restarts from an empty picture. */
  readonly end: number;
  /** The moment the still picture shows. */
  readonly rest: number;
}

/** `rise` fades a part in while it moves up a few pixels; `fade` only fades it. */
export type Motion = 'rise' | 'fade';

export interface ShowOptions {
  /** When the part hides again; the clock's end unless given. */
  readonly to?: number;
  readonly motion?: Motion;
}

/** A shown part fades in over this many seconds, and out over as many. */
export const FADE = 0.3;
/** How far a rising part moves up as it fades in, in pixels. */
const RISE = 5;

export class Timeline {
  private readonly clock: Clock;
  private readonly rules: string[] = [];
  private count = 0;

  constructor(clock: Clock) {
    if (!(clock.rest > 0 && clock.rest < clock.end && clock.end < clock.loop)) {
      throw new RangeError(`a clock needs 0 < rest < end < loop, not rest ${clock.rest}, end ${clock.end}, loop ${clock.loop}`);
    }
    this.clock = clock;
  }

  private pct(seconds: number): string {
    return `${((Math.min(Math.max(seconds, 0), this.clock.loop) / this.clock.loop) * 100).toFixed(3)}%`;
  }

  /**
   * A class that shows its part from `from` until `to` (fading in and out) and hides it the rest of the loop.
   * Its still state is shown when `rest` falls in [from, to). Throws when the window is too short to fade in and
   * out, or does not sit inside the loop, since its keyframes would then not ascend.
   */
  show(from: number, { to = this.clock.end, motion = 'rise' }: ShowOptions = {}): string {
    if (!(from > 0 && from + 2 * FADE < to && to < this.clock.loop)) {
      throw new RangeError(`a part shown from ${from}s to ${to}s needs more than ${2 * FADE}s inside the ${this.clock.loop}s loop`);
    }
    const name = `a${this.count}`;
    this.count += 1;
    const off = motion === 'rise' ? `opacity:0;transform:translateY(${RISE}px)` : 'opacity:0';
    const on = motion === 'rise' ? 'opacity:1;transform:translateY(0)' : 'opacity:1';
    const still = from <= this.clock.rest && this.clock.rest < to ? 1 : 0;
    this.rules.push(
      `@keyframes ${name}{0%,${this.pct(from)}{${off}}${this.pct(from + FADE)},${this.pct(to - FADE)}{${on}}${this.pct(to)},100%{${off}}}`,
      `.${name}{opacity:${still};animation:${name} ${this.clock.loop}s linear infinite}`,
    );
    return name;
  }

  /** Every class's keyframes and rule so far, one per line. */
  css(): string {
    return this.rules.join('\n');
  }
}

/**
 * A cron expression, as run/repeat/on/at.
 *
 * The IR stores a cron string because that is what
 * a scheduled DBOS workflow is compiled with. A
 * person setting up a weekly report is not writing
 * one, so the Inspector offers the four knobs the
 * design specifies and this is the translation
 * between them.
 *
 * Anything that is not one of the four shapes is
 * kept as the expression it is, under `custom` —
 * which is what makes the translation total. A
 * schedule the knobs cannot express is still
 * editable, and is never silently rewritten into
 * one they can.
 */

/** How often a run starts. */
export type Repeat = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

export const REPEATS: readonly Repeat[] = [
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'custom',
];

export type Schedule = {
  repeat: Repeat;

  /** The weekday, 0 to 6, for a weekly repeat, or
   *  the day of the month for a monthly one. */
  on: string;

  /** Time of day as `HH:MM`. Only the minutes
   *  matter to an hourly repeat. */
  at: string;

  /** The expression itself, which is what a
   *  `custom` repeat is edited as. */
  cron: string;
};

/**
 * The four shapes the knobs can say, and nothing
 * else.
 *
 * Fields are matched without leading zeros, so an
 * expression written `05 6 * * 0` reads as custom
 * rather than being rewritten to `5 6 * * 0` on
 * the next save.
 */
const FIELD = '(0|[1-9][0-9]?)';
const HOURLY = new RegExp(`^${FIELD} \\* \\* \\* \\*$`);
const DAILY = new RegExp(`^${FIELD} ${FIELD} \\* \\* \\*$`);
const WEEKLY = new RegExp(`^${FIELD} ${FIELD} \\* \\* ([0-6])$`);
const MONTHLY = new RegExp(`^${FIELD} ${FIELD} ${FIELD} \\* \\*$`);

/** What the knobs start at when the expression
 *  says nothing about them. */
const UNSAID: Pick<Schedule, 'on' | 'at'> = { on: '0', at: '09:00' };

/** Reads an expression as far as the knobs go. */
export function readSchedule(cron: string): Schedule {
  const hourly = HOURLY.exec(cron);
  if (hourly) {
    return { ...UNSAID, repeat: 'hourly', at: clock('0', hourly[1]), cron };
  }

  const daily = DAILY.exec(cron);
  if (daily) {
    return { ...UNSAID, repeat: 'daily', at: clock(daily[2], daily[1]), cron };
  }

  const weekly = WEEKLY.exec(cron);
  if (weekly) {
    return {
      repeat: 'weekly',
      on: weekly[3] ?? UNSAID.on,
      at: clock(weekly[2], weekly[1]),
      cron,
    };
  }

  const monthly = MONTHLY.exec(cron);
  if (monthly) {
    return {
      repeat: 'monthly',
      on: monthly[3] ?? UNSAID.on,
      at: clock(monthly[2], monthly[1]),
      cron,
    };
  }

  return { ...UNSAID, repeat: 'custom', cron };
}

/** The expression the knobs add up to. */
export function writeSchedule(schedule: Schedule): string {
  const [hour, minute] = split(schedule.at);

  switch (schedule.repeat) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${schedule.on}`;
    case 'monthly':
      return `${minute} ${hour} ${schedule.on} * *`;
    case 'custom':
      return schedule.cron;
  }
}

function clock(hour: string | undefined, minute: string | undefined): string {
  return `${pad(hour ?? '0')}:${pad(minute ?? '0')}`;
}

function pad(value: string): string {
  return value.padStart(2, '0');
}

/**
 * The hour and minute of an `HH:MM`, as a cron
 * writes them — no leading zeros, and anything
 * unreadable read as zero, because a half-typed
 * time still has to produce an expression.
 */
function split(at: string): [number, number] {
  const [hour, minute] = at.split(':');

  return [asNumber(hour), asNumber(minute)];
}

function asNumber(value: string | undefined): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

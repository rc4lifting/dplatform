import { previousSunday, addDays } from "date-fns";
export { addDays };

/**
 * Using the current time, get the start of what we define
 * as the "previous week" - Monday to Sunday.
 *
 * @returns The start of the current week, Monday.
 */
export function weekStart(): Date {
  const start = previousSunday(Date.now());
  return addDays(stripTime(start), 1);
}

export function stripTime(date: Date): Date {
  // Deep copy the original date
  const ndate = new Date(date);
  ndate.setHours(0);
  ndate.setMinutes(0);
  ndate.setSeconds(0);
  ndate.setMilliseconds(0);
  return ndate;
}

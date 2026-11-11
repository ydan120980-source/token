// Calendar arithmetic on the local dates the snapshot uses ("2026-10-27"), at noon UTC so no time zone moves a day.
export const shift = (date: string, days: number) => { const value = new Date(date + "T12:00:00Z"); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
export const weekday = (date: string) => (new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7;
export const md = (date: string) => Number(date.slice(5, 7)) + "/" + Number(date.slice(8, 10));
export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
/** The n dates ending with the given one, oldest first. */
export const lastDays = (end: string, count: number) => Array.from({ length: count }, (_, index) => shift(end, index - count + 1));

/** Local calendar day, YYYY-MM-DD. A session boundary is this date. */
export function localDate(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Move a local date by whole days. `date` is YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return localDate(new Date(year, month - 1, day + days));
}

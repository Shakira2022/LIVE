/** Convert date input values into local-time, half-open ISO boundaries. */
export function localDateFilterBounds(from: string, to: string) {
  const start = from ? parseLocalDate(from) : null;
  const end = to ? parseLocalDate(to) : null;

  if (start && end && start.getTime() > end.getTime()) {
    return { dateFrom: undefined, dateTo: undefined, error: "The start date must be on or before the end date." };
  }

  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setDate(end.getDate() + 1);

  return {
    dateFrom: start?.toISOString(),
    dateTo: end?.toISOString(),
    error: "",
  };
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

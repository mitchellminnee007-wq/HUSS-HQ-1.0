function validCalendarInput(input) {
  const match = input.trim().match(/^(\d{1,4})[-/](\d{1,2})[-/](\d{1,4})\s+(\d{1,2}):(\d{2})(?:\s+.*)?$/);
  if (!match) return false;
  const [, first, month, last, hour, minute] = match;
  const year = first.length === 4 ? Number(first) : Number(last);
  const day = first.length === 4 ? Number(last) : Number(first);
  const date = new Date(Date.UTC(year, Number(month) - 1, day));
  return year >= 2020 && Number(month) >= 1 && Number(month) <= 12 && day >= 1
    && date.getUTCFullYear() === year && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === day
    && Number(hour) < 24 && Number(minute) < 60;
}
module.exports = { validCalendarInput };

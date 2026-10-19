// Promised delivery date for shipped orders: N business days after the order date, counted in
// Luke's time zone (Lubbock, TX). Weekends and US federal holidays don't count.
const SHIPPING_BUSINESS_DAYS = 14;
const TIME_ZONE = 'America/Chicago';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

// "Today" as a calendar date in Lubbock, regardless of the server's clock zone.
function localDate(now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return utc(Number(parts.year), Number(parts.month), Number(parts.day));
}

function nthWeekday(year, month, weekday, n) {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekday(year, month, weekday) {
  const last = utc(year, month + 1, 0);
  return utc(year, month, last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7));
}

// A fixed-date holiday that lands on a weekend is observed on the nearest weekday.
function observed(year, month, day) {
  const d = utc(year, month, day);
  if (d.getUTCDay() === 6) return utc(year, month, day - 1);
  if (d.getUTCDay() === 0) return utc(year, month, day + 1);
  return d;
}

function federalHolidays(year) {
  return [
    observed(year, 1, 1),            // New Year's Day
    nthWeekday(year, 1, 1, 3),       // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3),       // Presidents' Day
    lastWeekday(year, 5, 1),         // Memorial Day
    observed(year, 6, 19),           // Juneteenth
    observed(year, 7, 4),            // Independence Day
    nthWeekday(year, 9, 1, 1),       // Labor Day
    nthWeekday(year, 10, 1, 2),      // Columbus Day
    observed(year, 11, 11),          // Veterans Day
    nthWeekday(year, 11, 4, 4),      // Thanksgiving
    observed(year, 12, 25),          // Christmas
  ].map(iso);
}

function isBusinessDay(d, holidays) {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(iso(d));
}

const longDate = (d) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d);

function deliverBy(now = new Date(), businessDays = SHIPPING_BUSINESS_DAYS) {
  const start = localDate(now);
  const year = start.getUTCFullYear();
  // Years either side cover holidays observed across a year boundary (e.g. Jan 1 on a Saturday).
  const holidays = new Set([year - 1, year, year + 1, year + 2].flatMap(federalHolidays));
  const cursor = new Date(start);
  let counted = 0;
  while (counted < businessDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (isBusinessDay(cursor, holidays)) counted++;
  }
  return { businessDays, orderDate: iso(start), orderLabel: longDate(start), deliverBy: iso(cursor), deliverByLabel: longDate(cursor) };
}

module.exports = { SHIPPING_BUSINESS_DAYS, deliverBy, federalHolidays };

const BEIJING_LATITUDE = 39.9042;
const BEIJING_LONGITUDE = 116.4074;
const BEIJING_UTC_OFFSET_HOURS = 8;
const OFFICIAL_ZENITH = 90.833;
const HOUR_MS = 60 * 60 * 1000;

function radians(value) {
  return value * Math.PI / 180;
}

function degrees(value) {
  return value * 180 / Math.PI;
}

function normalize(value, maximum) {
  return ((value % maximum) + maximum) % maximum;
}

function beijingDateParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function dayOfYear({ year, month, day }) {
  return Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / (24 * HOUR_MS));
}

function eventUtcHour(parts, sunrise) {
  const longitudeHour = BEIJING_LONGITUDE / 15;
  const approximateTime = dayOfYear(parts) + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  let trueLongitude = meanAnomaly
    + (1.916 * Math.sin(radians(meanAnomaly)))
    + (0.02 * Math.sin(radians(2 * meanAnomaly)))
    + 282.634;
  trueLongitude = normalize(trueLongitude, 360);

  let rightAscension = degrees(Math.atan(0.91764 * Math.tan(radians(trueLongitude))));
  rightAscension = normalize(rightAscension, 360);
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(radians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHour = (
    Math.cos(radians(OFFICIAL_ZENITH))
    - (sinDeclination * Math.sin(radians(BEIJING_LATITUDE)))
  ) / (cosDeclination * Math.cos(radians(BEIJING_LATITUDE)));
  if (cosHour > 1 || cosHour < -1) return null;

  const localHourAngle = (sunrise ? 360 - degrees(Math.acos(cosHour)) : degrees(Math.acos(cosHour))) / 15;
  const localMeanTime = localHourAngle + rightAscension - (0.06571 * approximateTime) - 6.622;
  return normalize(localMeanTime - longitudeHour, 24);
}

function eventDate(parts, sunrise) {
  const utcHour = eventUtcHour(parts, sunrise);
  if (utcHour === null) return null;
  const localHour = normalize(utcHour + BEIJING_UTC_OFFSET_HOURS, 24);
  const beijingMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day) - (BEIJING_UTC_OFFSET_HOURS * HOUR_MS);
  return new Date(beijingMidnightUtc + (localHour * HOUR_MS));
}

export function beijingSolarTimes(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = beijingDateParts(date);
  return {
    sunrise: eventDate(parts, true),
    sunset: eventDate(parts, false),
  };
}

export function themeForBeijingInstant(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const { sunrise, sunset } = beijingSolarTimes(date);
  if (!sunrise || !sunset) return "light";
  return date >= sunrise && date < sunset ? "light" : "dark";
}

export function nextBeijingSolarTransition(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const { sunrise, sunset } = beijingSolarTimes(date);
  if (sunrise && date < sunrise) return sunrise;
  if (sunset && date < sunset) return sunset;
  const tomorrow = new Date(date.getTime() + 24 * HOUR_MS);
  return beijingSolarTimes(tomorrow).sunrise || tomorrow;
}

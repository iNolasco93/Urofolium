import type { Procedure } from './types';

export const RESIDENCY_YEAR_KEYS = ['R1', 'R2', 'R3', 'R4', 'R5'] as const;

export type ResidencyYearKey = (typeof RESIDENCY_YEAR_KEYS)[number];
export type ResidencyFilter = 'current' | 'all' | ResidencyYearKey;

export interface ResidencyPeriod {
  key: ResidencyYearKey;
  startDate: string;
  endDateExclusive: string;
  shortRange: string;
  label: string;
}

function parseMonth(value: string | null | undefined): { year: number; monthIndex: number } | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  return { year, monthIndex: month - 1 };
}

function addMonths(month: string, count: number): string {
  const parsed = parseMonth(month);
  if (!parsed) return '';
  const index = parsed.year * 12 + parsed.monthIndex + count;
  const year = Math.floor(index / 12);
  const monthIndex = index % 12;
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function formatShortMonth(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${monthNumber}/${year.slice(-2)}`;
}

function monthDiff(from: string, to: string): number | null {
  const fromParsed = parseMonth(from);
  const toParsed = parseMonth(to);
  if (!fromParsed || !toParsed) return null;
  return (toParsed.year - fromParsed.year) * 12 + (toParsed.monthIndex - fromParsed.monthIndex);
}

function toMonth(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

export function getResidencyPeriod(startMonth: string, key: ResidencyYearKey): ResidencyPeriod | null {
  const yearNumber = Number(key.slice(1));
  if (!parseMonth(startMonth) || !Number.isInteger(yearNumber) || yearNumber < 1 || yearNumber > 5) return null;

  const startMonthForYear = addMonths(startMonth, (yearNumber - 1) * 12);
  const endMonthExclusive = addMonths(startMonth, yearNumber * 12);
  const endMonthInclusive = addMonths(endMonthExclusive, -1);
  const shortRange = `${formatShortMonth(startMonthForYear)} - ${formatShortMonth(endMonthInclusive)}`;

  return {
    key,
    startDate: `${startMonthForYear}-01`,
    endDateExclusive: `${endMonthExclusive}-01`,
    shortRange,
    label: `${key} · ${shortRange}`,
  };
}

export function getCurrentResidencyYear(startMonth: string | null | undefined, today = new Date()): ResidencyYearKey | null {
  if (!startMonth) return null;
  const months = monthDiff(startMonth, toMonth(today));
  if (months == null || months < 0) return null;
  const yearNumber = Math.floor(months / 12) + 1;
  if (yearNumber < 1 || yearNumber > 5) return null;
  return `R${yearNumber}` as ResidencyYearKey;
}

export function filterProceduresByResidency(
  procedures: Procedure[],
  startMonth: string | null | undefined,
  filter: ResidencyFilter
): Procedure[] {
  if (filter === 'all' || !startMonth) return procedures;
  const key = filter === 'current' ? getCurrentResidencyYear(startMonth) : filter;
  if (!key) return [];

  const period = getResidencyPeriod(startMonth, key);
  if (!period) return procedures;

  return procedures.filter(procedure => {
    const date = String(procedure.fecha).slice(0, 10);
    return date >= period.startDate && date < period.endDateExclusive;
  });
}

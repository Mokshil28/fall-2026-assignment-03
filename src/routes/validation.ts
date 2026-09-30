// IDs map to PostgreSQL integer columns; pagination accepts nonnegative integers.
export function parseInteger(value: unknown, minimum = 0): number | undefined {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) &&
    number >= minimum &&
    number <= 2147483647
    ? number
    : undefined;
}

// Required text must be nonblank and fit the database varchar(255) columns.
export function isRequiredText(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 255
  );
}

// Filtering and status updates share the same allowed values.
export function isStatus(value: unknown): value is string {
  return (
    typeof value === 'string' && ['TODO', 'IN_PROGRESS', 'DONE'].includes(value)
  );
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// International (+44 20 7946 0958, +1 (555) 123-4567) and North-American (555-123-4567, (555) 123 4567) numbers.
// Plain runs of digits (sizes, coordinates, "0 0 1440 1000") are deliberately left alone.
const PHONE_INTL = /(?<![\w+])\+\d{1,3}[\s.-]?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}(?!\w)/g;
const PHONE_NA = /(?<![\w.])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w])/g;

/** Replace email addresses and phone numbers with placeholders before text leaves the machine. */
export function maskPersonalData(text: string): string {
  return text.replace(EMAIL, '[email]').replace(PHONE_INTL, '[phone]').replace(PHONE_NA, '[phone]');
}

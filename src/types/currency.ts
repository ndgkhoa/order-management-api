/**
 * Currency values — single source of truth. Lives in src/types so the DB layer and the
 * app layer both depend on it without coupling to each other. `CURRENCIES` drives the
 * Drizzle column defaults, the `Currency` union, and the named `Currencies` constants.
 * Reference currencies as `Currencies.USD` and defaults as `DEFAULT_CURRENCY`, never a bare string.
 */
export const CURRENCIES = ['USD'] as const;

export type Currency = (typeof CURRENCIES)[number];

export const Currencies = {
  USD: 'USD',
} as const satisfies Record<string, Currency>;

/** Default currency for new orders/payments. */
export const DEFAULT_CURRENCY: Currency = Currencies.USD;

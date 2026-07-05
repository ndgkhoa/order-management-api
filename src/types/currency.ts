export const CURRENCIES = ['USD'] as const;

export type Currency = (typeof CURRENCIES)[number];

export const Currencies = {
  USD: 'USD',
} as const satisfies Record<string, Currency>;

export const DEFAULT_CURRENCY: Currency = Currencies.USD;

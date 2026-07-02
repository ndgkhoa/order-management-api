import { ProblemSchema } from '@infra/http/problem-details.js';

/**
 * Reusable OpenAPI error responses: maps each status code to the shared RFC 7807
 * Problem schema so protected/validated routes document their failure shapes.
 * Spread into a route's `schema.response`, e.g. `{ 200: X, ...errorResponses(400, 401) }`.
 */
export function errorResponses(...codes: number[]): Record<number, typeof ProblemSchema> {
  return Object.fromEntries(codes.map((code) => [code, ProblemSchema]));
}

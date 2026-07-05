import { ProblemSchema } from '@infra/http/problem-details';

export function errorResponses(...codes: number[]): Record<number, typeof ProblemSchema> {
  return Object.fromEntries(codes.map((code) => [code, ProblemSchema]));
}

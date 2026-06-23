import { Type, type Static } from '@sinclair/typebox';
import type { FastifyError, FastifyRequest } from 'fastify';

/** RFC 7807 Problem Details — the single error shape for every API error response. */
export const ProblemSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  detail: Type.String(),
  instance: Type.String(),
  requestId: Type.String(),
  errors: Type.Optional(Type.Unknown()), // AJV validation details on 400
});
export type Problem = Static<typeof ProblemSchema>;

const BASE = 'https://order-management-api/errors';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

const SLUGS: Record<number, string> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
  429: 'rate-limited',
  500: 'internal',
};

export function titleFor(status: number): string {
  return TITLES[status] ?? (status >= 500 ? 'Internal Server Error' : 'Error');
}

export function problemSlug(status: number): string {
  return SLUGS[status] ?? 'error';
}

export function problemType(status: number): string {
  return `${BASE}/${problemSlug(status)}`;
}

/** Maps a Fastify error to a Problem. 5xx details are hidden to avoid leaking internals. */
export function buildProblem(err: FastifyError, req: FastifyRequest): Problem {
  const status = err.statusCode ?? 500;
  const problem: Problem = {
    type: problemType(status),
    title: titleFor(status),
    status,
    detail: status >= 500 ? 'Internal Server Error' : err.message,
    instance: req.url,
    requestId: req.id,
  };
  if (err.validation) {
    problem.errors = err.validation;
  }
  return problem;
}

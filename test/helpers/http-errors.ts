import type { FastifyInstance } from 'fastify';

export const httpErrorsStub = {
  badRequest: (m?: string) => Object.assign(new Error(m ?? 'bad request'), { statusCode: 400 }),
  unauthorized: (m?: string) => Object.assign(new Error(m ?? 'unauthorized'), { statusCode: 401 }),
  forbidden: (m?: string) => Object.assign(new Error(m ?? 'forbidden'), { statusCode: 403 }),
  notFound: (m?: string) => Object.assign(new Error(m ?? 'not found'), { statusCode: 404 }),
  conflict: (m?: string) => Object.assign(new Error(m ?? 'conflict'), { statusCode: 409 }),
} as unknown as FastifyInstance['httpErrors'];

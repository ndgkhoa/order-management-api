import fp from 'fastify-plugin';

export const correlationIdPlugin = fp((app) => {
  app.addHook('onSend', (request, reply, payload, done) => {
    reply.header('x-request-id', request.id);
    done(null, payload);
  });
});

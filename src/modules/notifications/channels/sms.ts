import type { FastifyBaseLogger } from 'fastify';
import type { NotificationProvider } from '@modules/notifications/notification-interface.js';

export function makeSmsProvider(log: FastifyBaseLogger): NotificationProvider {
  return {
    channel: 'sms',
    send(to, message) {
      log.info({ to, subject: message.subject }, 'TODO: SMS provider not implemented');
      return Promise.resolve();
    },
  };
}

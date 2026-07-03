import type { FastifyBaseLogger } from 'fastify';
import type { NotificationProvider } from '@infra/notify/notification-provider.js';

/**
 * SMS channel — intentionally a STUB (YAGNI): the multi-channel abstraction is the point, not a
 * real SMS integration. Logs the intent and resolves; never throws, so it can't fail a dispatch.
 */
export function makeSmsProvider(log: FastifyBaseLogger): NotificationProvider {
  return {
    channel: 'sms',
    send(to, message) {
      log.info({ to, subject: message.subject }, 'TODO: SMS provider not implemented');
      return Promise.resolve();
    },
  };
}

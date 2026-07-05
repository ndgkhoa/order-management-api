import type { Mailer } from '@infra/mail/mailer.js';
import type { NotificationProvider } from '@modules/notifications/notification-interface.js';

export function makeEmailProvider(
  mailer: Pick<Mailer, 'sendMail'>,
  from: string,
): NotificationProvider {
  return {
    channel: 'email',
    async send(to, message) {
      await mailer.sendMail({ from, to, subject: message.subject, text: message.body });
    },
  };
}

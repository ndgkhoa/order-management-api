import type { Mailer } from '@infra/mail/mailer.js';
import type { NotificationProvider } from '@infra/providers/notification-provider.js';

/**
 * Email channel — wraps the existing Nodemailer transport (no mailer logic duplicated). Takes
 * only the `sendMail` surface so it is trivially unit-testable with a fake.
 */
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

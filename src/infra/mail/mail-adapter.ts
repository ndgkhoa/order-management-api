import type { OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import type { Mailer } from '@infra/mail/mailer.js';

/** Adapter pattern: hides Nodemailer behind a domain-meaningful interface. */
export interface MailAdapter {
  sendOrderCreatedEmail(payload: OrderCreatedPayload): Promise<void>;
}

export function makeMailAdapter(mailer: Mailer, from: string): MailAdapter {
  return {
    async sendOrderCreatedEmail(p) {
      await mailer.sendMail({
        from,
        to: p.email,
        subject: `Order ${p.orderId} received`,
        text: `Hi! Your order for ${p.quantity}x ${p.product} (${(p.amount / 100).toFixed(2)}) is confirmed.`,
      });
    },
  };
}

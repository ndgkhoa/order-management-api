import type { OrderCreatedPayload } from '@infra/mq/outbox-event-types.js';
import type { Mailer } from '@infra/mail/mailer.js';

/** Adapter pattern: hides Nodemailer behind a domain-meaningful interface. */
export interface MailAdapter {
  sendOrderCreatedEmail(payload: OrderCreatedPayload): Promise<void>;
}

export function makeMailAdapter(mailer: Mailer, from: string): MailAdapter {
  return {
    async sendOrderCreatedEmail(p) {
      const lines = p.items.map((i) => `  ${i.quantity}x ${i.sku}`).join('\n');
      await mailer.sendMail({
        from,
        to: p.email,
        subject: `Order ${p.orderId} received`,
        text: `Hi! Your order is confirmed:\n${lines}\nTotal: ${(p.totalCents / 100).toFixed(2)}`,
      });
    },
  };
}

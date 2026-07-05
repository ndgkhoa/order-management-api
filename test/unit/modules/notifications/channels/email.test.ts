import { describe, it, expect, vi } from 'vitest';
import { makeEmailProvider } from '@modules/notifications/channels/email';

describe('emailProvider', () => {
  it('sends via the mailer with from/to/subject/text', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const provider = makeEmailProvider({ sendMail }, 'no-reply@orders.test');

    expect(provider.channel).toBe('email');
    await provider.send('customer@x.dev', { subject: 'Order paid', body: 'Your order is paid.' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'no-reply@orders.test',
      to: 'customer@x.dev',
      subject: 'Order paid',
      text: 'Your order is paid.',
    });
  });
});

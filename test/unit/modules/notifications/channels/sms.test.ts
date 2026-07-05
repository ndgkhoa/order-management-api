import { describe, it, expect, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { makeSmsProvider } from '@modules/notifications/channels/sms.js';

describe('smsProvider', () => {
  it('logs a TODO and resolves without throwing', async () => {
    const info = vi.fn();
    const log = { info } as unknown as FastifyBaseLogger;
    const provider = makeSmsProvider(log);

    expect(provider.channel).toBe('sms');
    await expect(
      provider.send('+15551234567', { subject: 'Delivered', body: 'Your order arrived.' }),
    ).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![1]).toMatch(/TODO/i);
  });
});

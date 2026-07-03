/** A rendered, transport-agnostic notification (templates produce this; providers send it). */
export interface NotificationMessage {
  subject: string;
  body: string;
}

/**
 * A delivery channel (email, sms, …). Keeping transport behind this interface lets the handler
 * fan a single rendered message out to multiple channels without knowing how each delivers.
 */
export interface NotificationProvider {
  readonly channel: string;
  send(to: string, message: NotificationMessage): Promise<void>;
}

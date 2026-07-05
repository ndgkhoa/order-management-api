export interface NotificationMessage {
  subject: string;
  body: string;
}

export interface NotificationProvider {
  readonly channel: string;
  send(to: string, message: NotificationMessage): Promise<void>;
}

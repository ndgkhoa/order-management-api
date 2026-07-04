import nodemailer from 'nodemailer';

/** Nodemailer transport (Mailpit in dev — plain SMTP, no auth/TLS). */
export function makeMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
  });
}

export type Mailer = ReturnType<typeof makeMailer>;

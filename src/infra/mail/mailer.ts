import nodemailer from 'nodemailer';

export function makeMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false,
  });
}

export type Mailer = ReturnType<typeof makeMailer>;

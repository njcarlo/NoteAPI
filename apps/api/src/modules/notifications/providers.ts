import nodemailer from 'nodemailer';
import { env } from '../../config/env';

export interface SmsMessage {
  to: string;
  body: string;
  senderName: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<{ providerMessageId: string | null }>;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

/** Masks a phone number or email for logs and admin screens. */
export function maskRecipient(recipient: string): string {
  if (recipient.includes('@')) {
    const [user = '', domain = ''] = recipient.split('@');
    return `${user.slice(0, 2)}•••@${domain}`;
  }
  return recipient.length > 7 ? `${recipient.slice(0, 6)}•••${recipient.slice(-4)}` : '•••';
}

/** Development: prints messages to the worker log instead of sending them. */
export class ConsoleSmsProvider implements SmsProvider {
  async send(message: SmsMessage) {
    console.log(
      `[sms] to ${maskRecipient(message.to)} from ${message.senderName}: ${message.body}`,
    );
    return { providerMessageId: null };
  }
}

/** Semaphore (semaphore.co), a Philippine SMS gateway. */
export class SemaphoreSmsProvider implements SmsProvider {
  constructor(private readonly apiKey: string) {}

  async send(message: SmsMessage) {
    const res = await fetch('https://api.semaphore.co/api/v4/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        apikey: this.apiKey,
        // Semaphore expects local format (09XXXXXXXXX).
        number: message.to.replace(/^\+63/, '0'),
        message: message.body,
        sendername: message.senderName,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Semaphore responded ${res.status}`);
    const data = (await res.json()) as
      { message_id?: number | string }[] | { message_id?: number | string };
    const first = Array.isArray(data) ? data[0] : data;
    return { providerMessageId: first?.message_id != null ? String(first.message_id) : null };
  }
}

/** SMTP (Mailpit in development). */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
  });

  async send(message: EmailMessage) {
    const info = await this.transport.sendMail({
      from: env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return { providerMessageId: info.messageId ?? null };
  }
}

/** Resend (resend.com) HTTP API. */
export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string) {}

  async send(message: EmailMessage) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    const data = (await res.json()) as { id?: string };
    return { providerMessageId: data.id ?? null };
  }
}

/** Tests: keeps messages in memory; can be told to fail. */
export class MemoryProvider implements SmsProvider, EmailProvider {
  readonly sent: (SmsMessage | EmailMessage)[] = [];
  failNext = 0;

  async send(message: SmsMessage | EmailMessage) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Simulated provider failure');
    }
    this.sent.push(message);
    return { providerMessageId: `mem-${this.sent.length}` };
  }
}

export interface Providers {
  sms: SmsProvider;
  email: EmailProvider;
}

export const memorySms = new MemoryProvider();
export const memoryEmail = new MemoryProvider();

/** Chosen by SMS_PROVIDER and EMAIL_PROVIDER. */
export function providersFromEnv(): Providers {
  const sms =
    env.SMS_PROVIDER === 'semaphore'
      ? new SemaphoreSmsProvider(env.SEMAPHORE_API_KEY as string)
      : env.SMS_PROVIDER === 'memory'
        ? memorySms
        : new ConsoleSmsProvider();
  const email =
    env.EMAIL_PROVIDER === 'resend'
      ? new ResendEmailProvider(env.RESEND_API_KEY as string)
      : env.EMAIL_PROVIDER === 'memory'
        ? memoryEmail
        : new SmtpEmailProvider();
  return { sms, email };
}

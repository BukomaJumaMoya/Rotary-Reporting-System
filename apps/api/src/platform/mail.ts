import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

/**
 * SMTP. `secure: true` means implicit TLS on 465; on 587 nodemailer upgrades with
 * STARTTLS, and `requireTLS` makes that upgrade mandatory rather than opportunistic —
 * without it a downgrade attack leaves password-reset links in plaintext on the wire.
 */
class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      requireTLS: !config.SMTP_SECURE && config.SMTP_REQUIRE_TLS,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({
      from: config.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}

/**
 * Development without a mail server. Prints the message so a developer can follow the
 * link, and is deliberately loud about the fact that nothing was delivered.
 */
class LogTransport implements MailTransport {
  send(mail: OutgoingMail): Promise<void> {
    console.log(
      `\n[mail:not-delivered] to=${mail.to}\n  subject: ${mail.subject}\n${mail.text
        .split('\n')
        .map((line) => `  | ${line}`)
        .join('\n')}\n`,
    );
    return Promise.resolve();
  }
}

/** Captures messages in memory so tests can assert on what would have been sent. */
export class CaptureTransport implements MailTransport {
  readonly sent: OutgoingMail[] = [];

  send(mail: OutgoingMail): Promise<void> {
    this.sent.push(mail);
    return Promise.resolve();
  }

  clear(): void {
    this.sent.length = 0;
  }
}

function build(): MailTransport {
  switch (config.MAIL_TRANSPORT) {
    case 'smtp':
      return new SmtpTransport();
    case 'capture':
      return new CaptureTransport();
    case 'log':
    default:
      return new LogTransport();
  }
}

let transport: MailTransport | undefined;

export function mailTransport(): MailTransport {
  transport ??= build();
  return transport;
}

/** Tests swap in a CaptureTransport; nothing else should call this. */
export function setMailTransport(replacement: MailTransport): void {
  transport = replacement;
}

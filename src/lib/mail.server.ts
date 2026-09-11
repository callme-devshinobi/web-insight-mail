import { smtpSend } from "./smtp.server";

export type Sender = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
};

export function buildFooter(sender: Sender): string {
  const lines = [
    "—",
    [sender.fromName, sender.fromEmail].filter(Boolean).join(" · "),
  ];
  if (sender.replyTo && sender.replyTo !== sender.fromEmail) {
    lines.push(`Reply to: ${sender.replyTo}`);
  }
  lines.push(
    'Not interested? Just reply with "unsubscribe" and I won\'t email you again.',
  );
  return lines.join("\n");
}

export function withFooter(body: string, sender: Sender): string {
  return `${body.trim()}\n\n${buildFooter(sender)}\n`;
}

export async function sendMail(opts: {
  sender: Sender;
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const password = process.env["SMTP_PASSWORD"];
  if (!password) {
    throw new Error(
      "Your mailbox password isn't saved yet. Add it before sending.",
    );
  }
  if (!opts.sender.fromEmail) {
    throw new Error("Set your sender email in Settings first.");
  }
  if (!opts.to) throw new Error("This prospect has no email address.");

  await smtpSend(
    {
      host: opts.sender.smtpHost,
      port: opts.sender.smtpPort || 465,
      secure: opts.sender.smtpSecure,
      username: opts.sender.smtpUsername || opts.sender.fromEmail,
      password,
    },
    {
      fromName: opts.sender.fromName,
      fromEmail: opts.sender.fromEmail,
      replyTo: opts.sender.replyTo,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
    },
  );
}

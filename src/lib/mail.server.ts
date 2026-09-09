export type Sender = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
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
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "No email API key is set up yet. Add your Resend API key before sending.",
    );
  }
  if (!opts.sender.fromEmail) {
    throw new Error("Set your sender email in Settings first.");
  }
  if (!opts.to) throw new Error("This prospect has no email address.");

  const from = opts.sender.fromName
    ? `${opts.sender.fromName} <${opts.sender.fromEmail}>`
    : opts.sender.fromEmail;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
      ...(opts.sender.replyTo ? { reply_to: opts.sender.replyTo } : {}),
      headers: {
        "List-Unsubscribe": `<mailto:${opts.sender.replyTo || opts.sender.fromEmail}?subject=unsubscribe>`,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Email service rejected the send (${res.status}): ${detail.slice(0, 300)}`);
  }
}

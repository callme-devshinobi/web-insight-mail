# Prospect Booster

Build a single-user web app (no login/auth — this is for my personal use only) called ProspectScan. It scans prospective clients' websites, finds a specific issue with each one, and drafts a personalized outreach email for me to review and send.

1. Settings screen

A settings panel where I enter, once, and it persists in the database (single row, no auth needed):

• SMTP settings: host, port, username, password, from name, from email, reply-to email

• Email template/format: a text area where I paste my email format/instructions (subject line pattern, tone, structure, signature). This is the prompt the AI will follow when writing each email.

• A "Test SMTP connection" button that sends a test email to a field I specify.

2. CSV upload

• Upload a CSV with columns: company name, email, website.

• Parse and show a preview table before starting the scan, so I can confirm columns mapped correctly.

• Allow re-mapping columns if headers don't match exactly.

3. Website scanning (backend function per row)

For each website URL, fetch the page HTML (and linked CSS where feasible) via a backend/edge function and check for:

• Modern layout signals: viewport meta tag present, use of CSS Grid/Flexbox, semantic HTML5 tags, presence of a modern framework fingerprint (Tailwind classes, Bootstrap 5, React/Next/Vue signatures), footer copyright year (flag if several years old).

• AI chat assistant present: Flag as missing if none found.

• Responsive/mobile optimization: viewport meta tag, media queries in linked stylesheets, mobile-friendly indicators.

• Store results per site as a simple checklist with pass/fail plus a short human-readable note for each failed check (this becomes the "issue list").

• Handle failures gracefully: timeouts, blocked/robots-restricted sites, broken URLs — mark as "couldn't scan" rather than crashing the batch, and let the batch continue.

• Show scan progress live (e.g., "12 of 50 scanned") since this runs row-by-row.

4. Issue selection + email generation

• From each site's failed checks, pick one issue (if multiple failed, pick the most impactful/first one — e.g., prioritize "no AI chat assistant" > "not responsive" > "outdated layout").

• Call an AI text-generation call (backend function) that takes: my saved email template/format, the company name, the website URL, and the one selected issue — and returns a subject line + email body personalized around that single issue. Keep it natural, not templated-sounding, and not overtly negative about their site.

• If a site couldn't be scanned or had no issues found, skip it (don't generate a generic email) and mark it "skipped" in the queue with the reason shown.

5. Review & approval queue

• A list/table view of every generated email: company name, website, the issue used, subject line, and a preview of the body.

• Clicking a row expands an editable subject + body field so I can tweak before sending.

• Each row has: Approve & Send, Skip, and Regenerate (re-run generation, optionally picking a different detected issue).

• A "Send All Approved" bulk action for anything I've already approved.

• Sent rows are marked with a status (Sent / Failed, with error message if failed) and timestamp.

6. Sending

• Sending uses the SMTP credentials from Settings via a backend function (not client-side) so credentials aren't exposed in the browser.

• Rate-limit sends slightly (e.g., a short delay between sends) to avoid tripping spam filters.

• Include a plain-text unsubscribe/reply-to line in the footer of every generated email, and make sure the "from" identity is clearly mine — cold outreach emails need a real sender identity and an opt-out, so bake that into the template default.

7. Data & scope

• No user accounts, no multi-tenant logic — single settings row, single ongoing prospect list.

• Persist CSV rows, scan results, generated drafts, and send status in the database so I can close the tab and come back to an in-progress batch.

• Keep the UI to three views: Settings, Upload/Scan, and Review Queue.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://web-insight-mail.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9a786e94-fe8b-4b7a-8d60-d8bb404686cc).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

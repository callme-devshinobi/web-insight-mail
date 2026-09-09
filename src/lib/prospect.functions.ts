import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { pickIssue, scanWebsite, type Check } from "./scan.server";
import { draftEmail } from "./ai.server";
import { sendMail, withFooter, type Sender } from "./mail.server";

function db() {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

type SettingsRow = {
  from_name: string;
  from_email: string;
  reply_to: string;
  email_template: string;
};

async function loadSettings(client: ReturnType<typeof db>): Promise<SettingsRow> {
  const { data, error } = await client
    .from("app_settings")
    .select("from_name, from_email, reply_to, email_template")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (
    data ?? { from_name: "", from_email: "", reply_to: "", email_template: "" }
  );
}

function senderOf(settings: SettingsRow): Sender {
  return {
    fromName: settings.from_name,
    fromEmail: settings.from_email,
    replyTo: settings.reply_to,
  };
}

async function generateFor(
  client: ReturnType<typeof db>,
  id: string,
  preferIssueKey: string | null,
) {
  const { data: row, error } = await client
    .from("prospects")
    .select("id, company, website, checks, scan_status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("That prospect no longer exists.");

  if (row.scan_status !== "scanned") {
    throw new Error("This site hasn't been scanned successfully yet.");
  }

  const checks = (row.checks ?? []) as unknown as Check[];
  const issue = pickIssue(checks, preferIssueKey);
  if (!issue) {
    await client
      .from("prospects")
      .update({
        email_status: "skipped",
        skip_reason: "No issues found — the site already passes every check.",
      })
      .eq("id", id);
    return { skipped: true as const };
  }

  const settings = await loadSettings(client);
  const draft = await draftEmail({
    template: settings.email_template,
    company: row.company,
    website: row.website,
    issueLabel: issue.label,
    issueNote: issue.note,
    fromName: settings.from_name,
    replyTo: settings.reply_to || settings.from_email,
  });

  await client
    .from("prospects")
    .update({
      selected_issue: issue.key,
      subject: draft.subject,
      body: draft.body,
      email_status: "draft",
      skip_reason: null,
      send_error: null,
    })
    .eq("id", id);

  return { skipped: false as const };
}

/** Scan one site, then draft its email. Called row-by-row from the browser. */
export const processProspect = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const client = db();
    const { data: row, error } = await client
      .from("prospects")
      .select("id, website")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That prospect no longer exists.");

    const outcome = await scanWebsite(row.website);

    if (!outcome.ok) {
      await client
        .from("prospects")
        .update({
          scan_status: "failed",
          scan_error: outcome.error,
          checks: [],
          email_status: "skipped",
          skip_reason: `Couldn't scan — ${outcome.error}`,
        })
        .eq("id", data.id);
      return { status: "failed" as const, reason: outcome.error };
    }

    await client
      .from("prospects")
      .update({
        scan_status: "scanned",
        scan_error: null,
        checks: outcome.checks as never,
      })
      .eq("id", data.id);

    try {
      const result = await generateFor(client, data.id, null);
      return result.skipped
        ? { status: "no_issues" as const }
        : { status: "drafted" as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client
        .from("prospects")
        .update({ email_status: "skipped", skip_reason: `Draft failed — ${message}` })
        .eq("id", data.id);
      return { status: "draft_failed" as const, reason: message };
    }
  });

/** Re-run generation, optionally around a different detected issue. */
export const regenerateDraft = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), issueKey: z.string().nullable().optional() }).parse(input),
  )
  .handler(async ({ data }) => {
    const client = db();
    const result = await generateFor(client, data.id, data.issueKey ?? null);
    return result;
  });

/** Send one approved email through the email service. */
export const sendProspect = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const client = db();
    const { data: row, error } = await client
      .from("prospects")
      .select("id, email, subject, body")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That prospect no longer exists.");
    if (!row.subject || !row.body) throw new Error("This row has no draft to send.");

    const settings = await loadSettings(client);
    const sender = senderOf(settings);

    try {
      await sendMail({
        sender,
        to: row.email,
        subject: row.subject,
        text: withFooter(row.body, sender),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await client
        .from("prospects")
        .update({ email_status: "failed", send_error: message })
        .eq("id", data.id);
      return { ok: false as const, error: message };
    }

    await client
      .from("prospects")
      .update({
        email_status: "sent",
        send_error: null,
        sent_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    return { ok: true as const };
  });

/** Send a test email to a chosen address to check the sending setup. */
export const sendTestEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ to: z.string().email() }).parse(input))
  .handler(async ({ data }) => {
    const client = db();
    const settings = await loadSettings(client);
    const sender = senderOf(settings);
    try {
      await sendMail({
        sender,
        to: data.to,
        subject: "ProspectScan test email",
        text: withFooter(
          "This is a test from ProspectScan. If you're reading this, your sending setup works.",
          sender,
        ),
      });
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

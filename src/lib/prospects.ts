import { supabase } from "@/integrations/supabase/client";

export type Check = { key: string; label: string; pass: boolean; note: string };

export type Prospect = {
  id: string;
  company: string;
  email: string;
  website: string;
  scan_status: string;
  checks: Check[];
  scan_error: string | null;
  selected_issue: string | null;
  subject: string | null;
  body: string | null;
  email_status: string;
  skip_reason: string | null;
  send_error: string | null;
  sent_at: string | null;
  created_at: string;
};

export type Settings = {
  from_name: string;
  from_email: string;
  reply_to: string;
  email_template: string;
  test_recipient: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_username: string;
};

export const EMPTY_SETTINGS: Settings = {
  from_name: "",
  from_email: "",
  reply_to: "",
  email_template: "",
  test_recipient: "",
  smtp_host: "",
  smtp_port: 465,
  smtp_secure: true,
  smtp_username: "",
};

export const DEFAULT_TEMPLATE = `Subject: keep it lowercase, specific and under 60 characters.

Tone: friendly, direct, like a note from one person to another. No corporate filler.

Structure:
1. One line saying what I noticed on their site (the single issue).
2. One or two lines on what that costs them or what it could unlock.
3. What I do about it, in plain words, in one line.
4. A single low-pressure ask — a 15 minute call this week.

Sign off with just my first name.`;

export async function fetchProspects(): Promise<Prospect[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Prospect[];
}

export async function fetchSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select(
      "from_name, from_email, reply_to, email_template, test_recipient, smtp_host, smtp_port, smtp_secure, smtp_username",
    )
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Settings | null) ?? EMPTY_SETTINGS;
}

export async function saveSettings(values: Settings) {
  const { error } = await supabase
    .from("app_settings")
    .update(values)
    .eq("id", true);
  if (error) throw new Error(error.message);
}

export const ISSUE_LABELS: Record<string, string> = {
  ai_chat: "No AI chat assistant",
  responsive: "Not mobile responsive",
  modern_layout: "Outdated layout",
};

export function issueLabel(key: string | null | undefined) {
  if (!key) return "—";
  return ISSUE_LABELS[key] ?? key;
}

export function statusTone(status: string) {
  switch (status) {
    case "sent":
      return "text-pass border-pass/30 bg-pass/10";
    case "failed":
      return "text-fail border-fail/30 bg-fail/10";
    case "approved":
      return "text-brand border-brand/40 bg-brand/10";
    case "draft":
      return "text-warn border-warn/30 bg-warn/10";
    default:
      return "text-faint border-hairline bg-panel-soft";
  }
}

export function statusLabel(p: Prospect) {
  switch (p.email_status) {
    case "sent":
      return "Sent";
    case "failed":
      return "Failed";
    case "approved":
      return "Approved";
    case "draft":
      return "Draft";
    case "skipped":
      return "Skipped";
    default:
      return p.scan_status === "pending" ? "Queued" : "No draft";
  }
}

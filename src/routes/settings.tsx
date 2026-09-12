import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, SectionTitle } from "@/components/AppShell";
import {
  DEFAULT_TEMPLATE,
  EMPTY_SETTINGS,
  fetchSettings,
  saveSettings,
  type Settings,
} from "@/lib/prospects";
import { sendTestEmail } from "@/lib/prospect.functions";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · ProspectScan" },
      {
        name: "description",
        content:
          "Set your sender identity and the email format ProspectScan follows when drafting outreach.",
      },
      { property: "og:title", content: "Settings · ProspectScan" },
      {
        property: "og:description",
        content:
          "Set your sender identity and the email format ProspectScan follows when drafting outreach.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const EMPTY: Settings = EMPTY_SETTINGS;

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="label-mono">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field field-focus mt-1 font-mono"
      />
    </label>
  );
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [form, setForm] = useState<Settings>(EMPTY);
  const runTest = useServerFn(sendTestEmail);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const set = (key: keyof Settings) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: () => saveSettings(form),
    onSuccess: () => {
      toast.success("Settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: async () => {
      await saveSettings(form);
      return runTest({ data: { to: form.test_recipient } });
    },
    onSuccess: (result) => {
      if (result.ok) toast.success(`Test email sent to ${form.test_recipient}`);
      else toast.error(result.error);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <SectionTitle title="Sender identity" meta="used on every email" />
      <section className="glass space-y-3 rounded-2xl p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From name" value={form.from_name} onChange={set("from_name")} placeholder="Dennis Martins" />
          <Field label="From email" value={form.from_email} onChange={set("from_email")} placeholder="dennis@yourdomain.com" type="email" />
        </div>
        <Field label="Reply-to email" value={form.reply_to} onChange={set("reply_to")} placeholder="dennis@yourdomain.com" type="email" />
        <p className="font-mono text-[10px] leading-relaxed text-faint">
          Your from address must use a domain you've verified with your email service, or sends will
          be rejected. Every email automatically ends with your name, address and a one-line opt-out.
        </p>
      </section>

      <SectionTitle title="Mail server" meta="your Namecheap mailbox" />
      <section className="glass space-y-3 rounded-2xl p-4">
        <Field
          label="Server address"
          value={form.smtp_host}
          onChange={set("smtp_host")}
          placeholder="mail.privateemail.com"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Port"
            value={String(form.smtp_port ?? "")}
            onChange={(v) =>
              setForm((prev) => ({ ...prev, smtp_port: Number(v.replace(/\D/g, "")) || 0 }))
            }
            placeholder="465"
          />
          <Field
            label="Username"
            value={form.smtp_username}
            onChange={set("smtp_username")}
            placeholder="dennis@callme-devshinobi.site"
          />
        </div>
        <label className="flex items-center justify-between rounded-lg bg-panel-soft px-3 py-2.5 ring-1 ring-hairline">
          <span className="text-[13px] text-foreground">Use SSL/TLS (port 465)</span>
          <input
            type="checkbox"
            checked={form.smtp_secure}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, smtp_secure: e.target.checked }))
            }
            className="h-5 w-5 accent-brand"
          />
        </label>
        <p className="font-mono text-[10px] leading-relaxed text-faint">
          Turn SSL/TLS off only for port 587, which upgrades the connection after connecting. Your
          mailbox password is stored separately and encrypted — it never appears on this screen.
        </p>
      </section>

      <SectionTitle title="Email format" meta="the AI follows this" />
      <section className="glass rounded-2xl p-4">
        <span className="label-mono">Your format &amp; instructions</span>
        <textarea
          value={form.email_template}
          onChange={(e) => set("email_template")(e.target.value)}
          rows={14}
          placeholder={DEFAULT_TEMPLATE}
          className="field field-focus mt-1 resize-y leading-relaxed"
        />
        <button
          type="button"
          onClick={() => set("email_template")(DEFAULT_TEMPLATE)}
          className="mt-2 rounded-lg bg-panel-soft px-3 py-2 text-[12px] font-medium text-muted-foreground ring-1 ring-hairline"
        >
          Use starter format
        </button>
      </section>

      <SectionTitle title="Test your sending" />
      <section className="glass rounded-2xl p-4">
        <Field
          label="Send a test email to"
          value={form.test_recipient}
          onChange={set("test_recipient")}
          placeholder="you@yourdomain.com"
          type="email"
        />
        <button
          type="button"
          disabled={!form.test_recipient || test.isPending}
          onClick={() => test.mutate()}
          className="mt-3 w-full rounded-lg bg-panel px-3 py-2.5 text-[13px] font-medium text-foreground ring-1 ring-hairline disabled:opacity-40"
        >
          {test.isPending ? "Sending…" : "Send test email"}
        </button>
      </section>

      <button
        type="button"
        disabled={save.isPending}
        onClick={() => save.mutate()}
        className="mt-5 w-full rounded-xl bg-gradient-to-r from-brand to-violet py-3.5 font-display text-[14px] font-semibold text-ink shadow-lg shadow-brand/20 disabled:opacity-50"
      >
        {save.isPending ? "Saving…" : "Save settings"}
      </button>
    </AppShell>
  );
}

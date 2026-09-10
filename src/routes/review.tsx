import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Badge, SectionTitle } from "@/components/AppShell";
import {
  fetchProspects,
  issueLabel,
  statusLabel,
  statusTone,
  type Prospect,
} from "@/lib/prospects";
import { regenerateDraft, sendProspect } from "@/lib/prospect.functions";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review queue · ProspectScan" },
      {
        name: "description",
        content:
          "Review, edit and approve every AI-drafted outreach email before it goes out.",
      },
      { property: "og:title", content: "Review queue · ProspectScan" },
      {
        property: "og:description",
        content:
          "Review, edit and approve every AI-drafted outreach email before it goes out.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewPage,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ReviewPage() {
  const queryClient = useQueryClient();
  const { data: rows = [] } = useQuery({
    queryKey: ["prospects"],
    queryFn: fetchProspects,
    refetchInterval: 5000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { subject: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);

  const send = useServerFn(sendProspect);
  const regen = useServerFn(regenerateDraft);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["prospects"] });

  const drafted = rows.filter((r) => r.subject);
  const approved = rows.filter((r) => r.email_status === "approved");

  const editing = (row: Prospect) =>
    drafts[row.id] ?? { subject: row.subject ?? "", body: row.body ?? "" };

  const patch = (row: Prospect, next: Partial<{ subject: string; body: string }>) =>
    setDrafts((prev) => ({ ...prev, [row.id]: { ...editing(row), ...next } }));

  async function persistEdits(row: Prospect) {
    const value = drafts[row.id];
    if (!value) return;
    const { error } = await supabase
      .from("prospects")
      .update({ subject: value.subject, body: value.body })
      .eq("id", row.id);
    if (error) toast.error(error.message);
  }

  const setStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string }) => {
      const { error } = await supabase
        .from("prospects")
        .update({ email_status: status, skip_reason: reason ?? null })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  async function approveAndSend(row: Prospect) {
    setBusy(row.id);
    try {
      await persistEdits(row);
      const result = await send({ data: { id: row.id } });
      if (result.ok) toast.success(`Sent to ${row.company}`);
      else toast.error(result.error);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function regenerate(row: Prospect, issueKey: string | null) {
    setBusy(row.id);
    try {
      const result = await regen({ data: { id: row.id, issueKey } });
      if (result.skipped) toast.message("No issues left to write about — marked as skipped.");
      else toast.success("Draft regenerated");
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  async function sendAllApproved() {
    for (const row of approved) {
      setBulk(row.company);
      try {
        const result = await send({ data: { id: row.id } });
        if (!result.ok) toast.error(`${row.company}: ${result.error}`);
      } catch (e) {
        toast.error(`${row.company}: ${e instanceof Error ? e.message : String(e)}`);
      }
      refresh();
      await sleep(4000);
    }
    setBulk(null);
    toast.success("Finished sending approved emails");
    refresh();
  }

  return (
    <AppShell>
      <SectionTitle
        title="Review queue"
        meta={`${drafted.length} draft${drafted.length === 1 ? "" : "s"} · ${approved.length} approved`}
      />

      {rows.length === 0 ? (
        <div className="glass-soft rounded-2xl p-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Nothing here yet. Upload a CSV and run a scan first.
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        {rows.map((row) => {
          const open = openId === row.id;
          const value = editing(row);
          const failed = row.checks?.filter((c) => !c.pass) ?? [];
          const isBusy = busy === row.id;

          return (
            <article
              key={row.id}
              className={`rounded-2xl p-4 backdrop-blur-xl ${
                row.email_status === "approved"
                  ? "border border-brand/25 bg-panel"
                  : "border border-hairline bg-panel-soft"
              }`}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : row.id)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate font-display text-[15px] font-semibold">{row.company}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {row.website}
                  </p>
                </div>
                <Badge tone={statusTone(row.email_status)}>{statusLabel(row)}</Badge>
              </button>

              {row.email_status === "skipped" ? (
                <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
                  {row.skip_reason ?? "Skipped."}
                </p>
              ) : null}

              {row.subject ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {failed.map((check) => (
                      <span
                        key={check.key}
                        className={`rounded-md px-2 py-1 font-mono text-[10px] ring-1 ${
                          check.key === row.selected_issue
                            ? "bg-fail/10 text-fail ring-fail/20"
                            : "bg-panel-soft text-muted-foreground ring-hairline"
                        }`}
                      >
                        {check.label}
                      </span>
                    ))}
                  </div>

                  {open ? (
                    <div className="mt-3 space-y-2">
                      <div>
                        <span className="label-mono">Subject</span>
                        <input
                          value={value.subject}
                          onChange={(e) => patch(row, { subject: e.target.value })}
                          onBlur={() => persistEdits(row)}
                          className="field field-focus mt-1 font-mono"
                        />
                      </div>
                      <div>
                        <span className="label-mono">Body</span>
                        <textarea
                          value={value.body}
                          rows={10}
                          onChange={(e) => patch(row, { body: e.target.value })}
                          onBlur={() => persistEdits(row)}
                          className="field field-focus mt-1 resize-y leading-relaxed"
                        />
                      </div>
                      {failed.length > 1 ? (
                        <div>
                          <span className="label-mono">Regenerate around</span>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {failed.map((check) => (
                              <button
                                key={check.key}
                                type="button"
                                disabled={isBusy}
                                onClick={() => regenerate(row, check.key)}
                                className="rounded-md bg-panel-soft px-2 py-1 font-mono text-[10px] text-muted-foreground ring-1 ring-hairline disabled:opacity-40"
                              >
                                {check.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="mt-3">
                        <span className="label-mono">Subject</span>
                        <p className="mt-1 font-mono text-[12px] text-secondary-foreground">
                          {row.subject}
                        </p>
                      </div>
                      <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-muted-foreground">
                        {row.body}
                      </p>
                    </>
                  )}

                  <p className="mt-2 font-mono text-[10px] text-faint">
                    Issue used: {issueLabel(row.selected_issue)}
                  </p>

                  {row.email_status === "sent" ? (
                    <p className="mt-2 font-mono text-[10px] text-pass">
                      Sent {row.sent_at ? new Date(row.sent_at).toLocaleString() : ""}
                    </p>
                  ) : null}
                  {row.email_status === "failed" && row.send_error ? (
                    <p className="mt-2 font-mono text-[10px] leading-relaxed text-fail">
                      {row.send_error}
                    </p>
                  ) : null}

                  {row.email_status !== "sent" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => approveAndSend(row)}
                        className="flex-1 rounded-lg bg-brand py-2.5 text-[13px] font-semibold text-ink disabled:opacity-50"
                      >
                        {isBusy ? "Working…" : "Approve & Send"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || row.email_status === "approved"}
                        onClick={() => setStatus.mutate({ id: row.id, status: "approved" })}
                        className="rounded-lg bg-panel-soft px-3 py-2.5 text-[12px] font-medium text-secondary-foreground ring-1 ring-hairline disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => regenerate(row, null)}
                        className="rounded-lg bg-panel-soft px-3 py-2.5 text-[12px] font-medium text-secondary-foreground ring-1 ring-hairline disabled:opacity-40"
                      >
                        Regen
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          setStatus.mutate({
                            id: row.id,
                            status: "skipped",
                            reason: "Skipped by you.",
                          })
                        }
                        className="rounded-lg bg-panel-soft px-3 py-2.5 text-[12px] font-medium text-muted-foreground ring-1 ring-hairline disabled:opacity-40"
                      >
                        Skip
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          );
        })}
      </div>

      {approved.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            disabled={Boolean(bulk)}
            onClick={sendAllApproved}
            className="w-full rounded-xl bg-gradient-to-r from-brand to-violet py-3.5 font-display text-[14px] font-semibold text-ink shadow-lg shadow-brand/20 disabled:opacity-60"
          >
            {bulk ? `Sending — ${bulk}…` : `Send All Approved (${approved.length})`}
          </button>
          <p className="mt-2 text-center font-mono text-[10px] text-faint">
            Rate-limited · real sender · opt-out baked in
          </p>
        </div>
      ) : null}
    </AppShell>
  );
}

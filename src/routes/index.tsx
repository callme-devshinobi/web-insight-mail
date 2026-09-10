import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, Badge, SectionTitle } from "@/components/AppShell";
import { fetchProspects, statusLabel, statusTone } from "@/lib/prospects";
import { processProspect } from "@/lib/prospect.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ProspectScan · Scan sites, draft outreach" },
      {
        name: "description",
        content:
          "Upload a prospect list, scan each website for one fixable issue, and get a personalised outreach email drafted for every lead.",
      },
      { property: "og:title", content: "ProspectScan · Scan sites, draft outreach" },
      {
        property: "og:description",
        content:
          "Upload a prospect list, scan each website for one fixable issue, and get a personalised outreach email drafted for every lead.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UploadScanPage;
});

type Mapping = { company: string; email: string; website: string };

function guessColumn(headers: string[], candidates: string[]) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const index = lower.findIndex((h) => h === candidate);
    if (index >= 0) return headers[index]!;
  }
  for (const candidate of candidates) {
    const index = lower.findIndex((h) => h.includes(candidate));
    if (index >= 0) return headers[index]!;
  }
  return headers[0] ?? "";
}

function UploadScanPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsed, setParsed] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Mapping>({ company: "", email: "", website: "" });
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const process = useServerFn(processProspect);
  const { data: rows = [] } = useQuery({
    queryKey: ["prospects"],
    queryFn: fetchProspects,
    refetchInterval: scanning ? 1500 : false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["prospects"] });

  const counts = useMemo(() => {
    const scanned = rows.filter((r) => r.scan_status === "scanned").length;
    const failed = rows.filter((r) => r.scan_status === "failed").length;
    const issues = rows.filter((r) => r.checks?.some((c) => !c.pass)).length;
    return { scanned, failed, issues, total: rows.length };
  }, [rows]);

  function onFile(file: File) {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const fields = result.meta.fields ?? [];
        if (!fields.length) {
          toast.error("That file has no column headers.");
          return;
        }
        setFileName(file.name);
        setHeaders(fields);
        setParsed(result.data);
        setMapping({
          company: guessColumn(fields, ["company name", "company", "business", "name"]),
          email: guessColumn(fields, ["email", "e-mail", "contact email"]),
          website: guessColumn(fields, ["website", "site", "url", "domain"]),
        });
      },
      error: () => toast.error("Couldn't read that file."),
    });
  }

  async function startScan() {
    const payload = parsed
      .map((row) => ({
        company: (row[mapping.company] ?? "").trim(),
        email: (row[mapping.email] ?? "").trim(),
        website: (row[mapping.website] ?? "").trim(),
      }))
      .filter((row) => row.website);

    if (!payload.length) {
      toast.error("No usable rows — check the website column mapping.");
      return;
    }

    const { data: inserted, error } = await supabase
      .from("prospects")
      .insert(payload)
      .select("id");
    if (error) {
      toast.error(error.message);
      return;
    }

    setParsed([]);
    setHeaders([]);
    setFileName("");
    if (fileInput.current) fileInput.current.value = "";

    const ids = (inserted ?? []).map((r) => r.id);
    setScanning(true);
    setProgress({ done: 0, total: ids.length });
    refresh();

    for (const [index, id] of ids.entries()) {
      try {
        await process({ data: { id } });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      setProgress({ done: index + 1, total: ids.length });
      refresh();
    }

    setScanning(false);
    refresh();
    toast.success("Scan finished — head to Review to check the drafts.");
  }

  async function clearList() {
    const { error } = await supabase.from("prospects").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) toast.error(error.message);
    else {
      toast.success("Prospect list cleared");
      refresh();
    }
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <AppShell>
      {scanning ? (
        <section className="glass rounded-2xl p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Scanning
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums">
                {progress.done}
                <span className="text-xl text-faint">/{progress.total}</span>
              </p>
            </div>
            <Badge tone="text-brand border-brand/30 bg-brand/10">Live</Badge>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-panel">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand to-violet transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-3 flex gap-4 font-mono text-[10px] text-muted-foreground">
            <span>
              <span className="text-pass">●</span> {counts.scanned} scanned
            </span>
            <span>
              <span className="text-fail">●</span> {counts.issues} with issues
            </span>
            <span>
              <span className="text-warn">●</span> {counts.failed} couldn't scan
            </span>
          </div>
        </section>
      ) : null}

      {!scanning ? (
        <>
          <SectionTitle title="Upload prospects" meta="company · email · website" />
          <section className="glass rounded-2xl p-4">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
              }}
              className="block w-full font-mono text-[12px] text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-panel file:px-3 file:py-2 file:font-sans file:text-[12px] file:font-medium file:text-foreground"
            />
            {fileName ? (
              <p className="mt-2 font-mono text-[10px] text-faint">
                {fileName} · {parsed.length} rows
              </p>
            ) : (
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-faint">
                A CSV with a company name, an email address and a website address.
              </p>
            )}
          </section>
        </>
      ) : null}

      {headers.length > 0 ? (
        <>
          <SectionTitle title="Check the columns" meta={`${parsed.length} rows`} />
          <section className="glass rounded-2xl p-4">
            <div className="space-y-2">
              {(["company", "email", "website"] as const).map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
                    {key}
                  </span>
                  <select
                    value={mapping[key]}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [key]: e.target.value }))}
                    className="field field-focus"
                  >
                    {headers.map((header) => (
                      <option key={header} value={header} className="bg-popover">
                        {header}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl ring-1 ring-hairline">
              <table className="w-full text-[12px]">
                <thead className="bg-panel">
                  <tr className="text-left">
                    {["Company", "Email", "Website"].map((head) => (
                      <th
                        key={head}
                        className="px-2 py-1.5 font-mono text-[10px] uppercase tracking-wider text-faint"
                      >
                        {head}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t border-hairline">
                      <td className="max-w-[10rem] truncate px-2 py-2">{row[mapping.company]}</td>
                      <td className="max-w-[10rem] truncate px-2 py-2 font-mono text-[11px] text-muted-foreground">
                        {row[mapping.email]}
                      </td>
                      <td className="max-w-[10rem] truncate px-2 py-2 font-mono text-[11px] text-muted-foreground">
                        {row[mapping.website]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={startScan}
              className="mt-3 w-full rounded-xl bg-gradient-to-r from-brand to-violet py-3 font-display text-[14px] font-semibold text-ink shadow-lg shadow-brand/20"
            >
              Looks right — start scan
            </button>
          </section>
        </>
      ) : null}

      {rows.length > 0 ? (
        <>
          <SectionTitle
            title="Prospect list"
            meta={`${counts.total} rows · ${counts.failed} couldn't scan`}
          />
          <div className="space-y-2">
            {rows.map((row) => {
              const failed = row.checks?.filter((c) => !c.pass) ?? [];
              return (
                <div key={row.id} className="glass-soft rounded-xl p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{row.company || "—"}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {row.website}
                      </p>
                    </div>
                    <Badge tone={statusTone(row.email_status)}>{statusLabel(row)}</Badge>
                  </div>
                  {row.scan_error ? (
                    <p className="mt-2 font-mono text-[10px] leading-relaxed text-warn">
                      {row.scan_error}
                    </p>
                  ) : null}
                  {row.checks?.length ? (
                    <div className="mt-2 space-y-1 font-mono text-[10px]">
                      {row.checks.map((check) => (
                        <div key={check.key} className="flex gap-2">
                          <span className={check.pass ? "text-pass" : "text-fail"}>
                            {check.pass ? "✓" : "✕"}
                          </span>
                          <span className={check.pass ? "text-faint" : "text-muted-foreground"}>
                            {check.pass ? check.label : check.note}
                          </span>
                        </div>
                      ))}
                      {failed.length === 0 ? (
                        <p className="text-faint">No issues — skipped.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {!scanning ? (
            <button
              type="button"
              onClick={clearList}
              className="mt-4 w-full rounded-lg bg-panel-soft py-2.5 text-[12px] font-medium text-muted-foreground ring-1 ring-hairline"
            >
              Clear prospect list
            </button>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}

const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

export type DraftInput = {
  template: string;
  company: string;
  website: string;
  issueLabel: string;
  issueNote: string;
  fromName: string;
  replyTo: string;
  avoidSubjects?: string[];
};

export type Draft = { subject: string; body: string };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: "string" },
    body: { type: "string" },
  },
} as const;

function buildPrompt(input: DraftInput): string {
  const avoid = (input.avoidSubjects ?? []).filter(Boolean).slice(0, 15);
  return [
    "You write short, natural cold outreach emails on behalf of one freelancer/agency owner.",
    "",
    "THE SENDER'S OWN FORMAT AND INSTRUCTIONS — THIS IS THE HIGHEST AUTHORITY.",
    "Follow it exactly: its subject-line pattern, tone, ordering, length, paragraph structure and sign-off.",
    "Where anything below conflicts with it, the sender's format wins.",
    "---",
    input.template.trim() ||
      "(No format supplied — write a short, warm, 4-6 sentence plain-text email with a clear one-line ask.)",
    "---",
    "",
    "PROSPECT:",
    `Company: ${input.company}`,
    `Website: ${input.website}`,
    "",
    "THE SINGLE ISSUE TO BUILD THE EMAIL AROUND:",
    `${input.issueLabel} — ${input.issueNote}`,
    "",
    "RULES:",
    "- Build the whole email around that one issue only. Do not list other problems.",
    "- Frame it as an opportunity, never as criticism of their site or team.",
    "- Sound like a real person typing, not a template. No 'I hope this email finds you well'.",
    "- Plain text only. No markdown, no HTML, no placeholder brackets like [Name].",
    `- Sign off as ${input.fromName || "the sender"}.`,
    "- Do NOT add an unsubscribe line or a signature block with contact details; those are appended automatically.",
    "",
    "SUBJECT LINE:",
    "- Follow the sender's subject pattern if their format specifies one.",
    `- It must be unique to ${input.company} — reference something specific to this company or this issue.`,
    "- Never reuse a phrasing you have used for another company; vary the wording, angle and rhythm every time.",
    avoid.length
      ? `- Subjects already used for other prospects (do NOT reuse or lightly reword any of these):\n${avoid.map((s) => `  • ${s}`).join("\n")}`
      : "",
    "",
    `Variation seed (use it only to pick a fresh angle, never mention it): ${Math.random().toString(36).slice(2, 10)}`,
    "",
    "Write the complete email body — never truncate it, never end with an ellipsis.",
    "Return JSON with a 'subject' and a 'body'.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export async function draftEmail(input: DraftInput): Promise<Draft> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured (missing key).");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      input: buildPrompt(input),
      stream: true,
      reasoning: { effort: "low", summary: "auto" },
      text: {
        format: {
          type: "json_schema",
          name: "outreach_email",
          strict: true,
          schema: SCHEMA,
        },
      },
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("AI is rate limited right now — try again in a moment.");
    if (res.status === 402) throw new Error("AI credits are exhausted. Add credits in Lovable to keep generating.");
    if (res.status === 403) throw new Error("AI access is blocked for this workspace.");
    throw new Error(`AI request failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: { output_text?: string };
        };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (event.type === "response.completed" && event.response?.output_text) {
          if (!text) text = event.response.output_text;
        }
      } catch {
        /* ignore keep-alive / partial frames */
      }
    }
  }

  if (!text.trim()) throw new Error("The AI returned an empty draft. Try regenerating.");

  let parsed: Draft;
  try {
    parsed = JSON.parse(text) as Draft;
  } catch {
    throw new Error("The AI returned an unreadable draft. Try regenerating.");
  }
  if (!parsed.subject?.trim() || !parsed.body?.trim()) {
    throw new Error("The AI returned an incomplete draft. Try regenerating.");
  }
  return { subject: parsed.subject.trim(), body: parsed.body.trim() };
}

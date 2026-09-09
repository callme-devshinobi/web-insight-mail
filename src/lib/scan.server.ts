export type Check = {
  key: string;
  label: string;
  pass: boolean;
  note: string;
};

export type ScanOutcome =
  | { ok: true; checks: Check[] }
  | { ok: false; error: string };

const UA =
  "Mozilla/5.0 (compatible; ProspectScan/1.0; +https://example.com/bot)";

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,text/css,*/*" },
    });
    if (!res.ok) throw new Error(`site responded ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const CHAT_SIGNATURES = [
  "intercom",
  "drift.com",
  "driftt",
  "tawk.to",
  "crisp.chat",
  "tidio",
  "hs-scriptloader",
  "hubspot conversations",
  "livechatinc",
  "zdassets",
  "zendesk",
  "freshchat",
  "botpress",
  "voiceflow",
  "chatwoot",
  "olark",
  "manychat",
  "smartsupp",
  "gorgias",
  "chatbase",
  "landbot",
  "chat-widget",
  "chatwidget",
  "ai-assistant",
  "ai chat",
  "messenger/js/messenger",
  "userlike",
  "helpcrunch",
  "jivosite",
  "kommunicate",
];

const FRAMEWORK_SIGNATURES: Array<[RegExp, string]> = [
  [/tailwind|class="[^"]*\b(flex|grid)\b[^"]*\b(gap-|px-|py-|md:)/i, "Tailwind"],
  [/bootstrap(\.min)?\.css|container-fluid|col-md-|data-bs-/i, "Bootstrap"],
  [/__NEXT_DATA__|\/_next\//i, "Next.js"],
  [/data-reactroot|react-dom|__REACT_DEVTOOLS/i, "React"],
  [/data-v-[0-9a-f]{8}|__NUXT__|vue(\.min)?\.js/i, "Vue"],
  [/svelte-[0-9a-z]{6}/i, "Svelte"],
  [/wp-content\/themes\/[^"']*\/(assets|dist)\//i, "modern WP theme"],
];

const SEMANTIC_TAGS = ["<header", "<nav", "<main", "<section", "<article", "<footer", "<aside"];

export async function scanWebsite(rawUrl: string): Promise<ScanOutcome> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { ok: false, error: "That doesn't look like a usable web address." };

  let html: string;
  try {
    html = await fetchText(url, 15000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("aborted") || message.includes("abort")) {
      return { ok: false, error: "The site took too long to respond (timed out)." };
    }
    return { ok: false, error: `Couldn't reach the site — ${message}.` };
  }

  if (html.trim().length < 200) {
    return { ok: false, error: "The site returned an empty or blocked page." };
  }

  const lower = html.toLowerCase();

  // Pull linked stylesheets (max 3) so we can look for media queries / layout.
  const cssHrefs: string[] = [];
  const linkRe = /<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && cssHrefs.length < 3) {
    const hrefMatch = /href=["']([^"']+)["']/i.exec(m[0]);
    if (!hrefMatch?.[1]) continue;
    try {
      cssHrefs.push(new URL(hrefMatch[1], url).toString());
    } catch {
      /* ignore bad href */
    }
  }

  const cssParts = await Promise.all(
    cssHrefs.map((href) => fetchText(href, 8000).catch(() => "")),
  );
  const inlineStyles = (html.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n");
  const css = (cssParts.join("\n") + "\n" + inlineStyles).toLowerCase();

  const checks: Check[] = [];

  // 1. AI chat assistant
  const chatHit = CHAT_SIGNATURES.find((sig) => lower.includes(sig));
  checks.push({
    key: "ai_chat",
    label: "AI chat assistant",
    pass: Boolean(chatHit),
    note: chatHit
      ? `Chat widget detected (${chatHit}).`
      : "No chat widget or AI assistant found, so first-touch questions go unanswered outside office hours.",
  });

  // 2. Responsive / mobile
  const hasViewport = /<meta[^>]+name=["']?viewport["']?/i.test(html);
  const hasMediaQueries = css.includes("@media");
  const responsive = hasViewport && hasMediaQueries;
  checks.push({
    key: "responsive",
    label: "Mobile / responsive",
    pass: responsive,
    note: responsive
      ? "Viewport tag and responsive rules found."
      : !hasViewport
        ? "No mobile viewport tag, so the site renders desktop-width on phones."
        : "No responsive breakpoints found in the stylesheets, so the layout likely doesn't adapt on phones.",
  });

  // 3. Modern layout
  const framework = FRAMEWORK_SIGNATURES.find(([re]) => re.test(html));
  const modernCss = /display:\s*(grid|flex)|grid-template|flex-direction/.test(css);
  const semanticCount = SEMANTIC_TAGS.filter((tag) => lower.includes(tag)).length;
  const yearMatch = [...html.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,20}(19|20)\d{2}/gi)]
    .map((match) => Number(match[0].slice(-4)))
    .filter((year) => year > 1990 && year < 2100);
  const footerYear = yearMatch.length ? Math.max(...yearMatch) : null;
  const currentYear = new Date().getFullYear();
  const staleYear = footerYear !== null && currentYear - footerYear >= 2;

  const layoutSignals = [Boolean(framework), modernCss, semanticCount >= 3].filter(Boolean).length;
  const layoutOk = layoutSignals >= 2 && !staleYear;

  const layoutReasons: string[] = [];
  if (!framework) layoutReasons.push("no modern front-end framework fingerprint");
  if (!modernCss) layoutReasons.push("no CSS grid or flexbox layout");
  if (semanticCount < 3) layoutReasons.push("very few semantic HTML5 sections");
  if (staleYear) layoutReasons.push(`footer copyright still reads ${footerYear}`);

  checks.push({
    key: "modern_layout",
    label: "Modern layout",
    pass: layoutOk,
    note: layoutOk
      ? `Modern build detected${framework ? ` (${framework[1]})` : ""}${footerYear ? `, footer © ${footerYear}` : ""}.`
      : `Looks dated — ${layoutReasons.join(", ")}.`,
  });

  return { ok: true, checks };
}

// Most impactful first.
export const ISSUE_PRIORITY = ["ai_chat", "responsive", "modern_layout"];

export function pickIssue(checks: Check[], preferKey?: string | null): Check | null {
  const failed = checks.filter((check) => !check.pass);
  if (!failed.length) return null;
  if (preferKey) {
    const preferred = failed.find((check) => check.key === preferKey);
    if (preferred) return preferred;
  }
  for (const key of ISSUE_PRIORITY) {
    const hit = failed.find((check) => check.key === key);
    if (hit) return hit;
  }
  return failed[0] ?? null;
}

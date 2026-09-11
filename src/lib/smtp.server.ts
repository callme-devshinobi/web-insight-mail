/**
 * Minimal SMTP client that works both on the Cloudflare Workers runtime
 * (via `cloudflare:sockets`) and on Node during local dev (via node:net/tls).
 */

type Conn = {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  startTls(): Promise<void>;
  close(): void;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function cloudflareConn(
  host: string,
  port: number,
  implicitTls: boolean,
): Promise<Conn | null> {
  let mod: { connect: (a: unknown, o?: unknown) => unknown };
  try {
    const spec = "cloudflare:sockets";
    mod = (await import(/* @vite-ignore */ spec)) as never;
  } catch {
    return null;
  }

  type CfSocket = {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    startTls: () => CfSocket;
    close: () => Promise<void>;
  };

  let socket = mod.connect(
    { hostname: host, port },
    { secureTransport: implicitTls ? "on" : "starttls", allowHalfOpen: false },
  ) as CfSocket;

  let reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();

  return {
    async read() {
      const { value, done } = await reader.read();
      return done ? null : (value ?? null);
    },
    async write(data) {
      await writer.write(data);
    },
    async startTls() {
      reader.releaseLock();
      writer.releaseLock();
      socket = socket.startTls();
      reader = socket.readable.getReader();
      writer = socket.writable.getWriter();
    },
    close() {
      void socket.close().catch(() => {});
    },
  };
}

async function nodeConn(
  host: string,
  port: number,
  implicitTls: boolean,
): Promise<Conn> {
  const net = await import("node:net");
  const tls = await import("node:tls");

  type Duplex = {
    on: (e: string, cb: (arg?: unknown) => void) => void;
    write: (d: Uint8Array, cb: (err?: unknown) => void) => void;
    destroy: () => void;
  };

  const queue: Uint8Array[] = [];
  let waiter: ((v: Uint8Array | null) => void) | null = null;
  let ended = false;
  let failure: Error | null = null;

  const attach = (s: Duplex) => {
    s.on("data", (chunk) => {
      const buf = new Uint8Array(chunk as ArrayBufferLike as never);
      if (waiter) {
        const w = waiter;
        waiter = null;
        w(buf);
      } else queue.push(buf);
    });
    s.on("end", () => {
      ended = true;
      if (waiter) {
        waiter(null);
        waiter = null;
      }
    });
    s.on("error", (err) => {
      failure = err instanceof Error ? err : new Error(String(err));
      ended = true;
      if (waiter) {
        waiter(null);
        waiter = null;
      }
    });
  };

  const open = (): Promise<Duplex> =>
    new Promise((resolve, reject) => {
      const s = implicitTls
        ? tls.connect({ host, port, servername: host }, () => resolve(s as never))
        : net.connect({ host, port }, () => resolve(s as never));
      s.once("error", reject);
    });

  let stream = (await open()) as unknown as Duplex;
  attach(stream);

  return {
    read() {
      if (failure) return Promise.reject(failure);
      const next = queue.shift();
      if (next) return Promise.resolve(next);
      if (ended) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
    write(data) {
      return new Promise((resolve, reject) => {
        stream.write(data, (err) => (err ? reject(err) : resolve()));
      });
    },
    async startTls() {
      const upgraded = tls.connect({
        socket: stream as never,
        servername: host,
      });
      await new Promise<void>((resolve, reject) => {
        upgraded.once("secureConnect", () => resolve());
        upgraded.once("error", reject);
      });
      ended = false;
      queue.length = 0;
      stream = upgraded as unknown as Duplex;
      attach(stream);
    },
    close() {
      try {
        stream.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}

class SmtpSession {
  private buffer = "";
  constructor(private conn: Conn) {}

  private async pump(): Promise<void> {
    const chunk = await this.conn.read();
    if (chunk === null) throw new Error("The mail server closed the connection.");
    this.buffer += decoder.decode(chunk);
  }

  /** Reads one full SMTP reply (handles multi-line 250- continuations). */
  async reply(): Promise<{ code: number; text: string }> {
    for (;;) {
      const match = /^(\d{3})(?: [^\r\n]*)?\r\n/m.exec(this.buffer);
      const lines = this.buffer.split("\r\n");
      const last = lines.findIndex((l) => /^\d{3} /.test(l));
      if (last >= 0) {
        const text = lines.slice(0, last + 1).join("\n");
        this.buffer = lines.slice(last + 1).join("\r\n");
        return { code: Number(text.slice(0, 3)), text };
      }
      void match;
      await this.pump();
    }
  }

  async send(line: string): Promise<void> {
    await this.conn.write(encoder.encode(`${line}\r\n`));
  }

  async command(line: string, expect: number[], label: string) {
    await this.send(line);
    const res = await this.reply();
    if (!expect.includes(res.code)) {
      throw new Error(`${label} failed — mail server said: ${res.text.trim()}`);
    }
    return res;
  }

  startTls() {
    return this.conn.startTls();
  }

  close() {
    this.conn.close();
  }
}

function b64(input: string): string {
  const bytes = encoder.encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

function base64Body(text: string): string {
  const raw = b64(text.replace(/\r?\n/g, "\r\n"));
  return (raw.match(/.{1,76}/g) ?? []).join("\r\n");
}

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
};

export type SmtpMessage = {
  fromName: string;
  fromEmail: string;
  replyTo: string;
  to: string;
  subject: string;
  text: string;
};

export async function smtpSend(config: SmtpConfig, msg: SmtpMessage): Promise<void> {
  if (!config.host) throw new Error("Set your mail server address in Settings first.");
  if (!config.username || !config.password) {
    throw new Error("Set your mailbox username and password before sending.");
  }

  const conn =
    (await cloudflareConn(config.host, config.port, config.secure)) ??
    (await nodeConn(config.host, config.port, config.secure));

  const session = new SmtpSession(conn);
  try {
    const greeting = await session.reply();
    if (greeting.code !== 220) {
      throw new Error(`Mail server refused the connection: ${greeting.text.trim()}`);
    }

    const clientName = msg.fromEmail.split("@")[1] || "prospectscan.local";
    let ehlo = await session.command(`EHLO ${clientName}`, [250], "Handshake");

    if (!config.secure) {
      if (!/STARTTLS/i.test(ehlo.text)) {
        throw new Error("This mail server does not offer a secure connection on that port.");
      }
      await session.command("STARTTLS", [220], "Secure upgrade");
      await session.startTls();
      ehlo = await session.command(`EHLO ${clientName}`, [250], "Handshake");
    }

    if (/AUTH[ =-].*PLAIN/i.test(ehlo.text)) {
      await session.command(
        `AUTH PLAIN ${b64(`\u0000${config.username}\u0000${config.password}`)}`,
        [235],
        "Sign in",
      );
    } else {
      await session.command("AUTH LOGIN", [334], "Sign in");
      await session.command(b64(config.username), [334], "Sign in");
      await session.command(b64(config.password), [235], "Sign in");
    }

    await session.command(`MAIL FROM:<${msg.fromEmail}>`, [250], "Sender");
    await session.command(`RCPT TO:<${msg.to}>`, [250, 251], "Recipient");
    await session.command("DATA", [354], "Message start");

    const from = msg.fromName
      ? `${encodeHeader(msg.fromName)} <${msg.fromEmail}>`
      : msg.fromEmail;
    const unsubscribe = msg.replyTo || msg.fromEmail;
    const headers = [
      `From: ${from}`,
      `To: <${msg.to}>`,
      msg.replyTo ? `Reply-To: <${msg.replyTo}>` : "",
      `Subject: ${encodeHeader(msg.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${msg.fromEmail.split("@")[1] ?? "localhost"}>`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="utf-8"',
      "Content-Transfer-Encoding: base64",
      `List-Unsubscribe: <mailto:${unsubscribe}?subject=unsubscribe>`,
    ].filter(Boolean);

    const payload = `${headers.join("\r\n")}\r\n\r\n${base64Body(msg.text)}\r\n.`;
    await session.command(payload, [250], "Message delivery");
    await session.send("QUIT");
  } finally {
    session.close();
  }
}

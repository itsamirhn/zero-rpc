import { ADMIN_HTML } from "./ui.ts";

export interface Env {
  ROUTES: KVNamespace;
}

interface Route {
  upstream: string;
  headers: Record<string, string>;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const HEADER_RE = /^[A-Za-z0-9-]+$/;
const KEY_PREFIX = "route:";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    // Everything below is behind Cloudflare Access (Zero Trust). The Access app at
    // the edge gates who can reach the Worker at all; we just confirm its header is
    // present so a direct workers.dev hit without Access can't slip through.
    const denied = requireAccess(req, url);
    if (denied) return denied;

    if (path === "/") {
      if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
      return new Response(ADMIN_HTML, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (path === "/_routes" || path.startsWith("/_routes/")) {
      return handleRoutes(req, env, path);
    }

    return proxy(req, env, url);
  },
} satisfies ExportedHandler<Env>;

function requireAccess(req: Request, url: URL): Response | null {
  // Local dev (wrangler dev) has no Access edge to inject the header, so the admin
  // page would be unreachable. The Worker can only be hit on localhost during dev;
  // in production it is always served on its real hostname, never localhost.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return null;
  if (!req.headers.get("Cf-Access-Jwt-Assertion")) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
}

// ---- reverse proxy -----------------------------------------------------------

async function proxy(req: Request, env: Env, url: URL): Promise<Response> {
  const slug = url.pathname.slice(1).split("/")[0];
  if (!slug) return new Response("not found", { status: 404 });

  const raw = await env.ROUTES.get(KEY_PREFIX + slug);
  if (!raw) return new Response("not found", { status: 404 });
  const route = parseRoute(raw);

  // Preserve any path after the slug (e.g. /foo/bar -> upstream + /bar) and the query.
  const suffix = url.pathname.slice(1 + slug.length);
  const target = new URL(route.upstream);
  if (suffix) target.pathname = target.pathname.replace(/\/$/, "") + suffix;
  if (url.search) target.search = url.search;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("cf-access-jwt-assertion");
  headers.delete("cf-access-authenticated-user-email");
  headers.delete("cookie");
  // Stored headers (e.g. an API token for this upstream) override request headers.
  for (const [k, v] of Object.entries(route.headers)) headers.set(k, v);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const resp = await fetch(target, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: "manual",
  });

  // The runtime transparently decompresses the upstream body, so the original
  // content-encoding/length no longer describe the bytes we hand back. Drop them
  // or the client will try to decode an already-decoded payload.
  const out = new Response(resp.body, resp);
  out.headers.delete("content-encoding");
  out.headers.delete("content-length");
  // Cloudflare Access answers the CORS preflight; the origin must still mark the
  // actual response as cross-origin shareable.
  out.headers.set("Access-Control-Allow-Origin", req.headers.get("Origin") ?? "*");
  out.headers.append("Vary", "Origin");
  return out;
}

function parseRoute(raw: string): Route {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === "object" && typeof o.upstream === "string") {
      return { upstream: o.upstream, headers: o.headers ?? {} };
    }
  } catch {
    // legacy value: plain upstream URL string
  }
  return { upstream: raw, headers: {} };
}

// ---- admin api ---------------------------------------------------------------

async function handleRoutes(req: Request, env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/_routes(?:\/([^/]+))?$/);
  if (!m) return json({ error: "not found" }, 404);
  const slug = m[1];

  if (!slug) {
    if (req.method === "GET") {
      const { keys } = await env.ROUTES.list({ prefix: KEY_PREFIX });
      const routes = await Promise.all(
        keys.map(async (k) => {
          const raw = (await env.ROUTES.get(k.name)) ?? "";
          return { slug: k.name.slice(KEY_PREFIX.length), ...parseRoute(raw) };
        }),
      );
      return json({ routes });
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (req.method === "PUT") {
    if (!SLUG_RE.test(slug)) {
      return json({ error: "path must match [a-z0-9][a-z0-9-]*" }, 400);
    }
    const body = (await safeJson(req)) as { upstream?: string; headers?: unknown } | null;
    const upstream = body?.upstream?.trim();
    if (!upstream || !isHttpUrl(upstream)) {
      return json({ error: "`upstream` must be a valid http(s) URL" }, 400);
    }
    const headers = normalizeHeaders(body?.headers);
    if (!headers.ok) return json({ error: headers.error }, 400);
    await env.ROUTES.put(KEY_PREFIX + slug, JSON.stringify({ upstream, headers: headers.value }));
    return json({ slug, upstream, headers: headers.value });
  }

  if (req.method === "DELETE") {
    await env.ROUTES.delete(KEY_PREFIX + slug);
    return json({ deleted: true });
  }

  return json({ error: "method not allowed" }, 405);
}

function normalizeHeaders(
  input: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "`headers` must be an object of name -> value" };
  }
  const value: Record<string, string> = {};
  for (const [name, v] of Object.entries(input as Record<string, unknown>)) {
    const key = name.trim();
    if (!key) continue;
    if (!HEADER_RE.test(key)) return { ok: false, error: `invalid header name: ${name}` };
    if (typeof v !== "string") return { ok: false, error: `header ${name} value must be a string` };
    value[key] = v;
  }
  return { ok: true, value };
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

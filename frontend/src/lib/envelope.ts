/**
 * Server-side helpers for Next.js API route handlers that wrap the
 * browser ↔ Next.js wire encryption envelope.
 *
 * Wire protocol:
 *   - All encrypted requests use HTTP POST (because GET cannot carry a body).
 *   - The original logical method is sent in the ``X-Wire-Method`` header
 *     (preferred) and as the ``_wm`` query parameter (fallback for proxies
 *     that strip custom headers, e.g. CloudFront's default origin policy).
 *   - The plaintext is sealed with AES-GCM whose AAD is the URL path, so an
 *     envelope captured at one route cannot be replayed at another.
 *   - Plaintext carries a ``ts`` field; openRequest enforces a replay window.
 *   - Routes register a map of handlers keyed by logical method.
 *
 * Usage:
 *   export const POST = dispatchEnvelope({
 *     GET:    async (ctx, params) => ...,
 *     PATCH:  async (ctx, params) => ...,
 *     DELETE: async (ctx, params) => ...,
 *   });
 */

import { NextRequest, NextResponse } from "next/server";
import { openRequest } from "@/lib/server-crypto";

export interface RouteContext<TBody = unknown> {
  request: NextRequest;
  body: TBody;
  authHeader: string | null;
  fail: (status: number, message: string) => never;
}

export class HandlerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(status: number, message: string): never {
  throw new HandlerError(status, message);
}

type Handler<TParams = unknown> = (
  ctx: RouteContext,
  params: TParams
) => Promise<unknown> | unknown;

export type WireMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function runEnvelope<TParams>(
  request: NextRequest,
  routeArg: { params: Promise<TParams> } | TParams | undefined,
  handler: Handler<TParams>
): Promise<Response> {
  let envelope: { v?: number; epk?: string; n?: string; c?: string } | null = null;
  try {
    envelope = await request.json();
  } catch {
    envelope = null;
  }

  if (!envelope || !envelope.epk || !envelope.n || !envelope.c) {
    return NextResponse.json(
      { error: "Encrypted envelope required." },
      { status: 400 }
    );
  }

  let body: unknown = null;
  let seal: (data: unknown) => { n: string; c: string };

  try {
    const url = new URL(request.url);
    const opened = openRequest(envelope, url.pathname);
    body = opened.body;
    seal = opened.seal;
  } catch (err) {
    return NextResponse.json(
      { error: "Bad envelope: " + (err as Error).message },
      { status: 400 }
    );
  }

  const authHeader = request.headers.get("authorization");

  let resolvedParams: TParams = {} as TParams;
  if (
    routeArg &&
    typeof routeArg === "object" &&
    "params" in (routeArg as Record<string, unknown>)
  ) {
    resolvedParams = await (routeArg as { params: Promise<TParams> }).params;
  }

  let result: unknown;
  let status = 200;
  try {
    result = await handler(
      { request, body, authHeader, fail },
      resolvedParams as TParams
    );
  } catch (err) {
    if (err instanceof HandlerError) {
      result = { error: err.message };
      status = err.status;
    } else {
      console.error("Encrypted route handler error:", err);
      result = { error: "Internal error." };
      status = 500;
    }
  }

  const sealed = seal(result ?? null);
  return NextResponse.json(sealed, { status });
}

/**
 * Build the POST entry-point for a route. Reads the logical method from the
 * ``X-Wire-Method`` header first, falling back to the ``_wm`` query
 * parameter for proxies that strip non-allowlisted custom headers.
 */
export function dispatchEnvelope<TParams = unknown>(
  handlers: Partial<Record<WireMethod, Handler<TParams>>>
) {
  return async function POST(
    request: NextRequest,
    routeArg?: { params: Promise<TParams> } | TParams
  ): Promise<Response> {
    const headerMethod = request.headers.get("x-wire-method");
    let queryMethod: string | null = null;
    try {
      queryMethod = new URL(request.url).searchParams.get("_wm");
    } catch {
      queryMethod = null;
    }
    const wireMethod = ((headerMethod || queryMethod || "POST")
      .toUpperCase() as WireMethod);
    const handler = handlers[wireMethod];
    if (!handler) {
      return NextResponse.json(
        { error: `Method ${wireMethod} not allowed.` },
        { status: 405 }
      );
    }
    return runEnvelope(request, routeArg, handler);
  };
}

/**
 * Single-handler convenience: wrap any-method handler.
 */
export function withEnvelope<TParams = unknown>(handler: Handler<TParams>) {
  return async function POST(
    request: NextRequest,
    routeArg?: { params: Promise<TParams> } | TParams
  ): Promise<Response> {
    return runEnvelope(request, routeArg, handler);
  };
}

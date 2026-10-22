import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/", "/login", "/signup", "/offline", "/manifest.webmanifest", "/sw.js", "/robots.txt"]);
const PUBLIC_PREFIXES = ["/_next", "/api", "/icons"];
const REQUEST_ID = "x-request-id";
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) || /\.(png|ico|svg|webmanifest|txt)$/.test(pathname);
}

/**
 * Runs before every matched request:
 *  1. stamps a request id (kept if the upstream proxy sent a sane one) on the request and the
 *     response, so route handlers log it and clients can quote it in bug reports;
 *  2. cheap auth gate: no session cookie → /login. Real authorization happens server-side.
 */
export function proxy(req: NextRequest) {
  const incoming = req.headers.get(REQUEST_ID);
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  const { pathname } = req.nextUrl;

  if (!isPublicPath(pathname) && !req.cookies.get("opslens_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    res.headers.set(REQUEST_ID, requestId);
    return res;
  }

  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID, requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(REQUEST_ID, requestId);
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

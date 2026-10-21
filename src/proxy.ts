import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/", "/login", "/signup"];

/** Cheap edge check: no session cookie → login. Real authorization happens server-side per request. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.includes(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/api")) {
    return NextResponse.next();
  }
  if (!req.cookies.get("opslens_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

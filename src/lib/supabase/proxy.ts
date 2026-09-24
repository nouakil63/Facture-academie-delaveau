import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROUTES_PUBLIQUES = ["/connexion", "/api/cron"];

/** Rafraîchit la session Supabase et redirige les visiteurs non connectés vers /connexion. */
export async function mettreAJourSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !cle) {
    return new NextResponse("Configuration Supabase manquante (voir README).", { status: 500 });
  }

  const supabase = createServerClient(url, cle, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Ne rien intercaler entre la création du client et getClaims().
  const { data } = await supabase.auth.getClaims();
  const connecte = Boolean(data?.claims);
  const chemin = request.nextUrl.pathname;
  const publique = ROUTES_PUBLIQUES.some((r) => chemin === r || chemin.startsWith(`${r}/`));

  if (!connecte && !publique) {
    const redirection = request.nextUrl.clone();
    redirection.pathname = "/connexion";
    redirection.search = chemin === "/" ? "" : `?suite=${encodeURIComponent(chemin + request.nextUrl.search)}`;
    return NextResponse.redirect(redirection);
  }
  if (connecte && chemin === "/connexion") {
    const redirection = request.nextUrl.clone();
    redirection.pathname = "/";
    redirection.search = "";
    return NextResponse.redirect(redirection);
  }

  return response;
}

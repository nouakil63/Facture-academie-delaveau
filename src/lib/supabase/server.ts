import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseCleePublique, supabaseUrl } from "@/lib/env";

/**
 * Client Supabase côté serveur (Server Components, Server Actions, Route Handlers),
 * authentifié avec la session de l'utilisateur connecté : la RLS s'applique.
 */
export async function creerClientServeur() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl(), supabaseCleePublique(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Appelé depuis un Server Component : le proxy rafraîchit la session.
        }
      },
    },
  });
}

export type ClientSupabase = Awaited<ReturnType<typeof creerClientServeur>>;

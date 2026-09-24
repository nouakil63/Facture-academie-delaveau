"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Client Supabase côté navigateur (utilisé uniquement pour la connexion). */
export function creerClientNavigateur() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
  );
}

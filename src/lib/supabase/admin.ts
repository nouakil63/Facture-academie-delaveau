import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseCleeSecrete, supabaseUrl } from "@/lib/env";

/**
 * Client Supabase avec la clé secrète : contourne la RLS.
 * À n'utiliser QUE dans la tâche planifiée (cron), jamais pour une requête utilisateur.
 */
export function creerClientAdmin() {
  return createClient(supabaseUrl(), supabaseCleeSecrete(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

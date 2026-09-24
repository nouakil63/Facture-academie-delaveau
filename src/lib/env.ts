/** Accès centralisé aux variables d'environnement (lecture paresseuse : le build ne les exige pas). */

function requis(nom: string, valeur: string | undefined): string {
  if (!valeur) {
    throw new Error(`Variable d'environnement manquante : ${nom}. Voir le README (section Configuration).`);
  }
  return valeur;
}

export function supabaseUrl(): string {
  return requis("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
}

/** Clé publique (publishable / anon). */
export function supabaseCleePublique(): string {
  return requis(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** Clé secrète (service_role) — serveur uniquement, utilisée par la tâche planifiée. */
export function supabaseCleeSecrete(): string {
  return requis("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** URL publique de l'application (liens dans les e-mails, redirections). */
export function urlApplication(): string {
  const url = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return url.replace(/\/$/, "");
}

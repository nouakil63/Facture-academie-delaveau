import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Base PostgreSQL en mémoire (PGlite) reproduisant le minimum de Supabase
 * nécessaire aux migrations : rôles, schéma `auth`, fonctions auth.jwt()/auth.uid().
 */
export async function creerBase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt() ->> 'sub', '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  `);
  const dir = join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, f), "utf8"));
  }
  return db;
}

/** Exécute `fn` en tant qu'utilisateur authentifié portant l'e-mail donné. */
export async function commeUtilisateur<T>(db: PGlite, email: string, fn: () => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001", email, role: "authenticated" });
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${claims}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
  }
}

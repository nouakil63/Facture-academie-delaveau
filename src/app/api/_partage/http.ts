import "server-only";
import { creerClientServeur } from "@/lib/supabase/server";

/*
 * Outils communs aux routes API (dossier privé `_partage` : non routable).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function estUuid(valeur: string): boolean {
  return UUID.test(valeur);
}

/**
 * Équivalent de exigerUtilisateur() pour une route : pas de redirection, null si la session
 * est absente ou expirée (la route répond alors 401).
 */
export async function sessionUtilisateur() {
  const supabase = await creerClientServeur();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, utilisateur: data.user };
}

/** Réponse d'erreur en texte brut (lisible telle quelle dans un onglet ou une iframe). */
export function erreurTexte(statut: number, message: string): Response {
  return new Response(message, {
    status: statut,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

/** Encodage RFC 5987 d'un nom de fichier (paramètre filename*). */
function encoderRfc5987(valeur: string): string {
  return encodeURIComponent(valeur).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** En-tête Content-Disposition avec repli ASCII (filename) et nom exact encodé (filename*). */
export function dispositionContenu(nomFichier: string, telecharger: boolean): string {
  const ascii = nomFichier
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  return `${telecharger ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encoderRfc5987(nomFichier)}`;
}

/** Réponse PDF : affichée dans le navigateur (inline) ou téléchargée (attachment). */
export function reponsePdf(pdf: Buffer, nomFichier: string, telecharger: boolean): Response {
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": dispositionContenu(nomFichier, telecharger),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

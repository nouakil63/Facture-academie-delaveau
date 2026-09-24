/**
 * Chemin interne vers lequel renvoyer l'utilisateur après sa connexion (paramètre ?suite=).
 *
 * Protection contre les redirections ouvertes : seul un chemin relatif à l'application
 * est accepté. Refusés (→ "/") :
 *   - ce qui ne commence pas par « / » (URL absolue, « javascript: »…) ;
 *   - « //hote » et « /\hote », que les navigateurs interprètent comme une autre origine ;
 *   - toute barre oblique inverse et tout caractère de contrôle : les navigateurs
 *     convertissent « \ » en « / » et suppriment tabulations et retours à la ligne,
 *     si bien que « /\t/hote » deviendrait « //hote » ;
 *   - la page de connexion elle-même (boucle).
 */
export function cheminDeRetour(suite: unknown): string {
  if (typeof suite !== "string" || suite.length > 2048) return "/";
  if (!suite.startsWith("/") || suite.startsWith("//") || suite.startsWith("/\\")) return "/";
  for (const caractere of suite) {
    const code = caractere.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || caractere === "\\") return "/";
  }
  if (/^\/connexion(?:[/?#]|$)/.test(suite)) return "/";
  return suite;
}

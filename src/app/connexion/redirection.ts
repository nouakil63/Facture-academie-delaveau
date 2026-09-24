/** Origine fictive servant à normaliser le chemin comme le ferait le navigateur. */
const BASE_INTERNE = "http://interne.invalid";

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
 *   - la page de connexion elle-même (boucle) ;
 *   - tout chemin dont la forme NORMALISÉE (segments « . » et « .. », même encodés en %2e,
 *     résolus comme le fait le navigateur) commence par « // » ou désigne la page de
 *     connexion : « /.//hote » devient « //hote », que Next resérialise puis résout comme
 *     une autre origine.
 * La chaîne d'origine est renvoyée telle quelle (pas de réencodage).
 */
export function cheminDeRetour(suite: unknown): string {
  if (typeof suite !== "string" || suite.length > 2048) return "/";
  if (!suite.startsWith("/") || suite.startsWith("//") || suite.startsWith("/\\")) return "/";
  for (const caractere of suite) {
    const code = caractere.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || caractere === "\\") return "/";
  }
  if (/^\/connexion(?:[/?#]|$)/.test(suite)) return "/";
  let url: URL;
  try {
    url = new URL(suite, BASE_INTERNE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE_INTERNE || url.pathname.startsWith("//") || /^\/connexion(?:\/|$)/.test(url.pathname)) {
    return "/";
  }
  return suite;
}

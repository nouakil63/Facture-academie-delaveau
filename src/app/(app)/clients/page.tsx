import type { Metadata } from "next";
import Link from "next/link";
import { AcademieBadge } from "@/components/AcademieBadge";
import { IconeAlerte, IconePlus, IconeUtilisateurs } from "@/components/Icones";
import { RechercheClients } from "@/components/clients/RechercheClients";
import { academieSelectionnee, resoudreAcademie } from "@/lib/academie-selectionnee";
import { exigerUtilisateur } from "@/lib/auth";
import { chargerAcademies } from "@/lib/facturation/service";
import { avecArticle, destinatairesFacture, formatEuros, formatPeriode, nomClient, premierDuMois } from "@/lib/format";
import { CHAMPS_TARIF_POUR_CALCUL, mensuelEstime, type TarifPourCalcul } from "@/lib/tarifs";
import type { Academie, Client } from "@/lib/types";

export const metadata: Metadata = { title: "Clients" };

type ClientListe = Client & { tarifs: TarifPourCalcul[] };

/**
 * Filtre PostgREST `or=(…)` : recherche insensible à la casse sur plusieurs colonnes.
 * La saisie est échappée deux fois : d'abord pour LIKE (\ % _ précédés de \), puis pour
 * PostgREST : la valeur est placée entre guillemets (ce qui neutralise , ( ) et :),
 * \ et " y étant précédés de \. (PostgREST traduit tout * en %, sans échappement possible.)
 */
function filtreRecherche(saisie: string): string {
  const motif = saisie.replace(/[\\%_]/g, (c) => `\\${c}`);
  const valeur = `"%${motif.replace(/[\\"]/g, (c) => `\\${c}`)}%"`;
  return ["nom", "prenom", "raison_sociale", "email", "cavaliers"].map((col) => `${col}.ilike.${valeur}`).join(",");
}

export default async function PageClients(props: PageProps<"/clients">) {
  const { supabase } = await exigerUtilisateur();
  const parametres = await props.searchParams;
  const q = (typeof parametres.q === "string" ? parametres.q : "").trim().slice(0, 100);
  const archives = parametres.archives === "1";
  const periode = premierDuMois();

  let academies: Academie[];
  let selection: string | null;
  try {
    [academies, selection] = await Promise.all([chargerAcademies(supabase), academieSelectionnee()]);
  } catch (e) {
    return <ErreurChargement message={e instanceof Error ? e.message : String(e)} />;
  }
  // Filtre de la coquille (cookie) : ignoré s'il désigne une académie inconnue ou désactivée.
  const academieFiltree = resoudreAcademie(selection, academies);
  const academiesParId = new Map(academies.map((a) => [a.id, a]));

  let requete = supabase.from("clients").select(`*, tarifs:tarifs_clients(${CHAMPS_TARIF_POUR_CALCUL})`);
  if (academieFiltree) requete = requete.eq("academie_id", academieFiltree.id);
  if (!archives) requete = requete.eq("actif", true);
  if (q) requete = requete.or(filtreRecherche(q));

  const resClients = await requete.order("nom").order("prenom");
  if (resClients.error) return <ErreurChargement message={resClients.error.message} />;

  const clients = (resClients.data as ClientListe[])
    .map((c) => ({
      ...c,
      nomAffiche: nomClient(c),
      destinataires: destinatairesFacture(c),
      mensuel: c.actif ? mensuelEstime(c.tarifs ?? [], periode) : null,
    }))
    .sort((a, b) => a.nomAffiche.localeCompare(b.nomAffiche, "fr", { sensitivity: "base" }));

  const totalMensuel = clients.reduce((s, c) => s + (c.mensuel ?? 0), 0);
  const nbActifs = clients.filter((c) => c.actif).length;
  const nbSansEmail = clients.filter((c) => c.actif && c.destinataires.length === 0).length;
  const nbArchives = clients.length - nbActifs;
  const mois = formatPeriode(periode);
  const pluriel = (n: number) => (n > 1 ? "s" : "");
  const resume =
    [
      academieFiltree ? academieFiltree.nom : "Toutes les académies",
      `${nbActifs} client${pluriel(nbActifs)} actif${pluriel(nbActifs)}` +
        (nbArchives > 0 ? `, ${nbArchives} archivé${pluriel(nbArchives)}` : ""),
    ].join(" · ") + (q ? ` correspondant à « ${q} »` : "");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="titre-page">Clients</h1>
          <p className="mt-1 text-sm text-muted">{resume}</p>
        </div>
        <Link href="/clients/nouveau" className="btn-primaire">
          <IconePlus />
          Nouveau client
        </Link>
      </div>

      <div className="carte carte-corps">
        <RechercheClients q={q} archives={archives} />
      </div>

      {nbSansEmail > 0 && (
        <p className="avertissement flex items-center gap-2">
          <IconeAlerte className="size-4 text-amber-600" />
          {nbSansEmail === 1
            ? "1 client actif n'a pas d'adresse e-mail : ses factures ne pourront pas être envoyées automatiquement."
            : `${nbSansEmail} clients actifs n'ont pas d'adresse e-mail : leurs factures ne pourront pas être envoyées automatiquement.`}
        </p>
      )}

      {clients.length === 0 ? (
        <div className="carte flex flex-col items-center px-6 py-14 text-center">
          <span className="rounded-full bg-brand-light p-3 text-brand">
            <IconeUtilisateurs className="size-6" />
          </span>
          {q ? (
            <>
              <p className="mt-4 font-medium text-ink">Aucun client ne correspond à « {q} »</p>
              <p className="mt-1 text-sm text-muted">
                Vérifiez l&apos;orthographe ou cherchez par cavalier, e-mail ou raison sociale.
                {academieFiltree ? ` La recherche est limitée à ${avecArticle(academieFiltree.nom)}.` : ""}
              </p>
              <Link href={archives ? "/clients?archives=1" : "/clients"} className="btn-secondaire mt-5">
                Effacer la recherche
              </Link>
            </>
          ) : (
            <>
              <p className="mt-4 font-medium text-ink">
                {academieFiltree ? `Aucun client pour ${avecArticle(academieFiltree.nom)}` : "Aucun client pour l'instant"}
              </p>
              <p className="mt-1 max-w-md text-sm text-muted">
                Créez la fiche de chaque payeur (parent, entreprise, sponsor), puis ajoutez-lui ses tarifs : la facture
                mensuelle sera préparée automatiquement.
              </p>
              <Link href="/clients/nouveau" className="btn-primaire mt-5">
                <IconePlus />
                Créer le premier client
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className="carte overflow-hidden">
          {/* Écrans larges : tableau */}
          <div className="hidden overflow-x-auto md:block">
            <table className="tableau">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Cavalier(s)</th>
                  <th>Académie</th>
                  <th>E-mail</th>
                  <th className="text-right">
                    Mensuel estimé
                    <span className="block text-[10px] font-normal normal-case tracking-normal">{mois}, HT</span>
                  </th>
                  {archives && <th>Statut</th>}
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const academie = academiesParId.get(c.academie_id);
                  return (
                    <tr key={c.id} className={c.actif ? "" : "text-muted"}>
                      <td>
                        <Link href={`/clients/${c.id}`} className="font-medium text-brand hover:underline">
                          {c.nomAffiche}
                        </Link>
                        {c.type === "professionnel" && (
                          <div className="text-xs text-muted">
                            {[c.prenom, c.nom].filter(Boolean).join(" ")}
                            {c.ville ? ` · ${c.ville}` : ""}
                          </div>
                        )}
                        {c.type === "particulier" && c.ville && <div className="text-xs text-muted">{c.ville}</div>}
                      </td>
                      <td className="max-w-56">
                        <span className="line-clamp-2">{c.cavaliers ?? <span className="text-muted">—</span>}</span>
                      </td>
                      <td>{academie && <AcademieBadge nom={academie.nom} couleur={academie.couleur} />}</td>
                      <td className="max-w-64">
                        {c.destinataires.length > 0 ? (
                          <span className="block truncate" title={c.destinataires.join(", ")}>
                            {c.destinataires[0]}
                            {c.destinataires.length > 1 && (
                              <span className="text-muted"> +{c.destinataires.length - 1}</span>
                            )}
                          </span>
                        ) : (
                          <SansEmail />
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        {c.mensuel == null ? (
                          <span className="text-muted" title="Client archivé : non facturé">
                            —
                          </span>
                        ) : c.mensuel === 0 ? (
                          <span className="text-muted">{formatEuros(0)}</span>
                        ) : (
                          <span className="font-medium">{formatEuros(c.mensuel)}</span>
                        )}
                      </td>
                      {archives && (
                        <td>
                          {c.actif ? (
                            <span className="badge bg-emerald-100 text-emerald-800">Actif</span>
                          ) : (
                            <span className="badge bg-zinc-200 text-zinc-600">Archivé</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-page/60">
                  <td colSpan={4} className="px-4 py-3 text-sm text-muted">
                    Total mensuel estimé des clients actifs affichés
                  </td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap text-brand tabular-nums">
                    {formatEuros(totalMensuel)}
                  </td>
                  {archives && <td />}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile : liste */}
          <ul className="divide-y divide-line md:hidden">
            {clients.map((c) => {
              const academie = academiesParId.get(c.academie_id);
              return (
                <li key={c.id}>
                  <Link href={`/clients/${c.id}`} className="block px-4 py-3 hover:bg-page">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className={`font-medium ${c.actif ? "text-brand" : "text-muted"}`}>{c.nomAffiche}</div>
                        {c.cavaliers && <div className="truncate text-sm text-ink">{c.cavaliers}</div>}
                      </div>
                      <div className="shrink-0 text-right text-sm font-medium tabular-nums">
                        {c.mensuel == null ? <span className="text-muted">—</span> : formatEuros(c.mensuel)}
                        <div className="text-xs font-normal text-muted">/ mois</div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      {academie && <AcademieBadge nom={academie.nom} couleur={academie.couleur} />}
                      {!c.actif && <span className="badge bg-zinc-200 text-zinc-600">Archivé</span>}
                      {c.destinataires.length > 0 ? <span className="truncate text-muted">{c.destinataires[0]}</span> : <SansEmail />}
                    </div>
                  </Link>
                </li>
              );
            })}
            <li className="flex items-center justify-between bg-page/60 px-4 py-3 text-sm">
              <span className="text-muted">Total mensuel estimé ({mois})</span>
              <span className="font-semibold text-brand tabular-nums">{formatEuros(totalMensuel)}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** « Académie Espoir » → « l'Académie Espoir » ; un autre nom est cité entre guillemets. */
function ErreurChargement({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <h1 className="titre-page">Clients</h1>
      <p role="alert" className="erreur">
        Impossible de charger les clients : {message}
      </p>
    </div>
  );
}

function SansEmail() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700" title="Factures non envoyables par e-mail">
      <IconeAlerte className="size-3.5" />
      Aucun e-mail
    </span>
  );
}

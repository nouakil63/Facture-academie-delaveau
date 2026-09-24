-- Données initiales : les deux entités de facturation.
-- Les informations légales sont celles de l'association Académie Delaveau.
-- Si l'Académie Espoir est une structure juridique distincte, corrigez ses
-- informations dans Paramètres avant d'émettre la première facture.

insert into public.entites (
  nom, prefixe_facture, couleur_primaire, couleur_secondaire, raison_sociale, forme_juridique,
  adresse_ligne1, code_postal, ville, siren, siret, rna, objet_social, ordre
) values
(
  'Académie Delaveau', 'AD', '#0050A0', '#DADADA', 'Académie Delaveau', 'Association déclarée',
  '5 chemin du Foyer', '14800', 'Vauville', '853 472 298', '853 472 298 00019', 'W143007272',
  'Formation de jeunes cavaliers vers le haut niveau à travers le double projet sportif et scolaire.', 1
),
(
  'Académie Espoir', 'AE', '#0050A0', '#DADADA', 'Académie Delaveau', 'Association déclarée',
  '5 chemin du Foyer', '14800', 'Vauville', '853 472 298', '853 472 298 00019', 'W143007272',
  'Formation de jeunes cavaliers vers le haut niveau à travers le double projet sportif et scolaire.', 2
);

-- Données initiales : paramètres de l'association et les deux académies.

insert into public.parametres (
  prefixe_facture, raison_sociale, forme_juridique,
  adresse_ligne1, code_postal, ville, siren, siret, rna, objet_social, email_contact
) values (
  'AD', 'Académie Delaveau', 'Association déclarée',
  '5 chemin du Foyer', '14800', 'Vauville', '853 472 298', '853 472 298 00019', 'W143007272',
  'Formation de jeunes cavaliers vers le haut niveau à travers le double projet sportif et scolaire.',
  'contact@academiedelaveau.com'
);

insert into public.academies (nom, couleur, ordre) values
  ('Académie Delaveau', '#0050A0', 1),
  ('Académie Espoir', '#2E7D8C', 2);

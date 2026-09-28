import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rendu PDF et envoi SMTP : bibliothèques Node chargées telles quelles côté serveur.
  serverExternalPackages: ["@react-pdf/renderer", "nodemailer"],
  // Ancienne page « Facturation mensuelle » : remplacée par « Facturation de l'année » (paramètres conservés).
  redirects() {
    return [{ source: "/facturation-mensuelle", destination: "/facturation-annuelle", permanent: false }];
  },
};

export default nextConfig;

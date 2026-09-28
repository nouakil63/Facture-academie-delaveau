import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Rendu PDF et envoi SMTP : bibliothèques Node chargées telles quelles côté serveur.
  serverExternalPackages: ["@react-pdf/renderer", "nodemailer"],
};

export default nextConfig;

import type { Metadata } from "next";
import { Inter, Jost } from "next/font/google";
import "./globals.css";

const texte = Inter({ variable: "--font-texte", subsets: ["latin"] });
const titre = Jost({ variable: "--font-titre", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Facturation — Académie Delaveau", template: "%s · Académie Delaveau" },
  description: "Suivi des clients et des factures de l'Académie Delaveau et de l'Académie Espoir.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${texte.variable} ${titre.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}

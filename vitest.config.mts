import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` lève une erreur hors de Next.js : neutralisé pour les tests.
      "server-only": fileURLToPath(new URL("./tests/server-only.ts", import.meta.url)),
    },
  },
  // Tests SQL : chaque base PGlite applique toutes les migrations (plus lent quand les fichiers tournent en parallèle).
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000 },
});

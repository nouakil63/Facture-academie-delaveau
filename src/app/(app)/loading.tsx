/**
 * Squelette discret affiché pendant le chargement d'une page de l'application
 * (la barre latérale reste visible et utilisable).
 */
export default function Chargement() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse space-y-6">
      <span className="sr-only">Chargement…</span>

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="h-3.5 w-48 rounded bg-line" />
          <div className="h-7 w-64 max-w-full rounded bg-line" />
        </div>
        <div className="h-9 w-40 rounded-lg bg-line/70" />
      </div>

      <div className="carte overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <div className="h-5 w-40 rounded bg-line" />
        </div>
        <div className="divide-y divide-line">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="h-3.5 w-24 rounded bg-line" />
              <div className="hidden h-3.5 flex-1 rounded bg-line/60 sm:block" />
              <div className="ml-auto h-3.5 w-20 rounded bg-line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

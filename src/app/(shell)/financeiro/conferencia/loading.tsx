export default function CarregandoConferencia() {
  return (
    <div
      role="status"
      aria-label="Carregando conferência"
      className="mx-auto w-full max-w-7xl space-y-6 motion-safe:animate-pulse"
    >
      <div className="bg-surface-3 h-12 w-full max-w-80 rounded-xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface-3 h-28 rounded-xl" />
        ))}
      </div>
      <div className="bg-surface-3 h-80 rounded-xl" />
    </div>
  );
}

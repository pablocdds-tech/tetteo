export default function CarregandoConferencia() {
  return (
    <div
      role="status"
      aria-label="Carregando conferência"
      className="mx-auto max-w-6xl animate-pulse space-y-6"
    >
      <div className="bg-surface-3 h-10 w-80 rounded-xl" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface-3 h-28 rounded-xl" />
        ))}
      </div>
      <div className="bg-surface-3 h-80 rounded-xl" />
    </div>
  );
}

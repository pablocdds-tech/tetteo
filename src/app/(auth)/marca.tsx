export function MarcaAutenticacao({
  operacional = false,
}: {
  operacional?: boolean;
}) {
  return (
    <div className="mb-8 flex items-center gap-3">
      <span
        aria-hidden="true"
        className="bg-accent text-accent-ink grid size-9 place-items-center rounded-md text-lg font-bold"
      >
        {operacional ? "P" : "T"}
      </span>
      <span className="text-2xl font-semibold tracking-tight">
        {operacional ? "PDV Vitaliano" : "Tetteo"}
      </span>
    </div>
  );
}

export const classeLinkAutenticacao =
  "text-accent rounded-sm text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-3";

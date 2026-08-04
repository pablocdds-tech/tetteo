/**
 * Molde das telas de autenticação — sem casca.
 *
 * Login não tem barra lateral nem topo: a casca só existe depois que o
 * sistema sabe quem você é.
 */
export default function LayoutAutenticacao({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6 py-12">
      {children}
    </div>
  );
}

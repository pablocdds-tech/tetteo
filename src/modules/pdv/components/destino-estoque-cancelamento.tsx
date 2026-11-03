"use client";

export function DestinoEstoqueCancelamento({
  valor,
  mudar,
  disabled = false,
  podeDevolver = true,
}: {
  valor: "PERDA" | "DEVOLVER";
  mudar: (v: "PERDA" | "DEVOLVER") => void;
  disabled?: boolean;
  podeDevolver?: boolean;
}) {
  return (
    <label className="text-ink-2 block text-sm font-semibold">
      Destino dos ingredientes
      <select
        className="border-line-2 bg-surface mt-2 block w-full rounded-md border p-2"
        value={valor}
        onChange={(e) => mudar(e.target.value as "PERDA" | "DEVOLVER")}
        disabled={disabled}
      >
        <option value="PERDA">
          Já usados: manter a saída e registrar perda
        </option>
        {podeDevolver && (
          <option value="DEVOLVER">Não usados: devolver ao estoque</option>
        )}
      </select>
      <span className="text-ink-3 mt-1 block font-normal">
        Produtos preparados não devolvem matéria-prima. O pagamento ao cliente é
        tratado separadamente.
      </span>
    </label>
  );
}

"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
export function DocumentosPessoa({ id }: { id: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false),
    [erro, setErro] = useState("");
  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    setOcupado(true);
    setErro("");
    try {
      const r = await fetch(`/api/financeiro-documentos/${id}`, {
        method: "POST",
        body: new FormData(f),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      f.reset();
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form className="mt-6 space-y-3" onSubmit={enviar}>
      <label className="block text-sm font-semibold">
        Documento (PDF ou imagem, até 5 MB)
        <input
          className="border-line-2 mt-2 block w-full rounded-md border p-3"
          type="file"
          name="arquivo"
          required
          accept="application/pdf,image/jpeg,image/png,image/webp"
        />
      </label>
      {erro && (
        <p className="text-bad" role="alert">
          {erro}
        </p>
      )}
      <button
        className="bg-accent text-accent-ink rounded-md px-4 py-2 font-semibold disabled:opacity-50"
        disabled={ocupado}
      >
        {ocupado ? "Enviando..." : "Enviar documento"}
      </button>
    </form>
  );
}

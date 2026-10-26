import Image from "next/image";

/** Somente arquivos locais; nomes e números de contas nunca saem para terceiros. */
export function MarcaBanco({ nome }: { nome: string }) {
  const normalizado = nome.toLowerCase();
  const marca = normalizado.includes("santander")
    ? { src: "/bancos/santander.ico", nome: "Santander" }
    : normalizado.includes("cappta")
      ? { src: "/bancos/cappta.png", nome: "Cappta" }
      : null;
  return (
    <span
      className="bg-surface-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
      aria-hidden
    >
      {marca ? (
        <Image src={marca.src} alt="" width={24} height={24} unoptimized />
      ) : (
        <span className="text-ink-2 text-xs font-bold">
          {/pagbank|pagseguro/.test(normalizado)
            ? "PB"
            : nome.trim().slice(0, 2).toUpperCase() || "CX"}
        </span>
      )}
    </span>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import { EnderecosCliente } from "./enderecos-cliente";
import type {
  ClienteAtendimentoPdv,
  SeedEntregaCliente,
} from "../cliente-types";
import { lerNumeroBr } from "@/lib/numero";
import type { AreaEntrega, EntregaEntrada } from "../entrega-types";
import {
  conferirAreaEntrega,
  esquemaEntregaEntrada,
  esquemaEnderecoEntrega,
} from "../schemas/entrega";

type DadosFormulario = Omit<EntregaEntrada, "endereco"> & {
  endereco: Omit<EntregaEntrada["endereco"], "uf"> & { uf: string };
};
const inicialVazia = (): DadosFormulario => ({
  destinatario: "",
  telefone: "",
  endereco: {
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    cep: "",
    referencia: "",
  },
  freteCentavos: 0,
  prazoMinutos: 30,
  motivoFreteManual: "",
});

export function DadosEntrega({
  entrega,
  areas,
  bloqueado,
  aoConfirmar,
  aoFechar,
  unidadeId,
  cliente,
  podeEditarClientes = false,
  seedEntrega,
}: {
  entrega: EntregaEntrada | null;
  areas: AreaEntrega[];
  bloqueado: boolean;
  aoConfirmar: (entrega: EntregaEntrada) => void;
  aoFechar: () => void;
  unidadeId: string;
  cliente?: ClienteAtendimentoPdv | null;
  podeEditarClientes?: boolean;
  seedEntrega?: SeedEntregaCliente;
}) {
  const router = useRouter();
  const [dados, setDados] = useState<DadosFormulario>(() =>
    structuredClone(
      seedEntrega
        ? {
            ...inicialVazia(),
            ...seedEntrega,
            endereco: seedEntrega.endereco ?? inicialVazia().endereco,
          }
        : (entrega ?? inicialVazia()),
    ),
  );
  const [gerenciarEnderecos, setGerenciarEnderecos] = useState(false);
  const [areaId, setAreaId] = useState(
    seedEntrega ? "" : (entrega?.areaId ?? ""),
  );
  const [versaoArea, setVersaoArea] = useState(
    seedEntrega ? undefined : entrega?.versaoArea,
  );
  const [frete, setFrete] = useState(
    ((seedEntrega ? 0 : (entrega?.freteCentavos ?? 0)) / 100)
      .toFixed(2)
      .replace(".", ","),
  );
  const [prazo, setPrazo] = useState(
    String(seedEntrega ? 30 : (entrega?.prazoMinutos ?? 30)),
  );
  const [alterado, setAlterado] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState("");
  const selecionada = areas.find((area) => area.id === areaId && area.ativa);
  const ativas = areas.filter((area) => area.ativa);
  const podeFechar = () =>
    !bloqueado &&
    (!alterado ||
      window.confirm("Descartar as alterações nos dados de entrega?"));
  useEffect(() => {
    if (!alterado) return;
    const proteger = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener("beforeunload", proteger);
    return () => window.removeEventListener("beforeunload", proteger);
  }, [alterado]);

  function alterar(
    chave: keyof Pick<
      EntregaEntrada,
      "destinatario" | "telefone" | "motivoFreteManual"
    >,
    valor: string,
  ) {
    setDados((atual) => ({ ...atual, [chave]: valor }));
    setAlterado(true);
  }
  function endereco(chave: keyof EntregaEntrada["endereco"], valor: string) {
    setDados((atual) => ({
      ...atual,
      endereco: { ...atual.endereco, [chave]: valor },
    }));
    setAlterado(true);
  }
  function selecionar(id: string) {
    setAreaId(id);
    setAlterado(true);
    setErro("");
    const area = ativas.find((item) => item.id === id);
    setVersaoArea(area?.versao);
    if (area) {
      setFrete((area.freteCentavos / 100).toFixed(2).replace(".", ","));
      setPrazo(String(area.prazoMinutos));
    } else {
      setFrete("0,00");
      setPrazo("30");
    }
    setDados((atual) => ({ ...atual, motivoFreteManual: "" }));
  }
  function confirmar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (bloqueado) return;
    setErro("");
    setErros({});
    if (areaId && !selecionada) {
      setErro(
        "Esta área não está mais disponível. Escolha outra ou informe o frete manualmente.",
      );
      return;
    }
    const numero = lerNumeroBr(frete);
    const freteCentavos =
      typeof numero === "number" ? Math.round(numero * 100) : NaN;
    if (
      !Number.isSafeInteger(freteCentavos) ||
      freteCentavos < 0 ||
      (!selecionada &&
        typeof numero === "number" &&
        Math.abs(numero * 100 - freteCentavos) > 0.00001)
    ) {
      setErros({
        freteCentavos: "Informe um frete válido com até duas casas decimais.",
      });
      return;
    }
    const entrada = {
      ...dados,
      endereco: { ...dados.endereco, uf: dados.endereco.uf.toUpperCase() },
      freteCentavos,
      prazoMinutos: Number(prazo),
      ...(selecionada
        ? { areaId: selecionada.id, versaoArea, motivoFreteManual: "" }
        : { areaId: undefined, versaoArea: undefined }),
    };
    const validacao = esquemaEntregaEntrada.safeParse(entrada);
    if (!validacao.success) {
      const campos: Record<string, string> = {};
      const mensagens: Record<string, string> = {
        destinatario: "Informe o nome de quem recebe, com 2 a 160 caracteres.",
        telefone: "Informe um telefone brasileiro com DDD ou deixe em branco.",
        "endereco.logradouro":
          "Informe a rua ou avenida, com 2 a 150 caracteres.",
        "endereco.numero": "Informe o número ou S/N, com até 20 caracteres.",
        "endereco.complemento": "Use até 150 caracteres no complemento.",
        "endereco.bairro": "Informe o bairro, com 2 a 80 caracteres.",
        "endereco.cidade": "Informe a cidade, com 2 a 80 caracteres.",
        "endereco.uf": "Informe uma UF brasileira válida.",
        "endereco.cep": "Informe um CEP de oito dígitos ou deixe em branco.",
        "endereco.referencia": "Use até 300 caracteres na referência.",
        areaId: "Escolha novamente a área para conferir a versão atual.",
        freteCentavos: "Informe um frete válido.",
        prazoMinutos: "Informe um prazo inteiro entre 1 e 1440 minutos.",
        motivoFreteManual:
          "Justifique o frete manual com pelo menos três caracteres.",
      };
      for (const detalhe of validacao.error.issues)
        campos[detalhe.path.join(".")] ??=
          mensagens[detalhe.path.join(".")] ?? "Confira este campo.";
      setErros(campos);
      setErro("Revise os campos indicados antes de confirmar a entrega.");
      return;
    }
    if (selecionada)
      try {
        conferirAreaEntrega(selecionada, validacao.data);
      } catch (falha) {
        setErro(
          falha instanceof Error ? falha.message : "Confira a área de entrega.",
        );
        return;
      }
    aoConfirmar(validacao.data);
  }

  return (
    <>
      <PainelLateral
        aberto
        titulo="Endereço e entrega"
        apoio="Confira o endereço, o frete e o prazo deste pedido. O cadastro do cliente é salvo separadamente."
        aoFechar={aoFechar}
        podeFechar={podeFechar}
        rodape={
          <>
            <Botao
              peso="secundario"
              onClick={() => {
                if (podeFechar()) aoFechar();
              }}
              disabled={bloqueado}
            >
              Voltar
            </Botao>
            <Botao type="submit" form="dados-entrega-pdv" disabled={bloqueado}>
              Confirmar entrega
            </Botao>
          </>
        }
      >
        <form id="dados-entrega-pdv" onSubmit={confirmar} className="space-y-5">
          {cliente && (
            <div className="border-line space-y-2 border-b pb-4">
              <p className="text-ink-2 text-sm">
                Cliente: <strong>{cliente.nome}</strong>
              </p>
              <Botao
                type="button"
                peso="secundario"
                disabled={bloqueado}
                onClick={() => setGerenciarEnderecos(true)}
              >
                {podeEditarClientes
                  ? "Escolher ou salvar endereço do cliente"
                  : "Escolher endereço do cliente"}
              </Botao>
            </div>
          )}
          <fieldset disabled={bloqueado} className="space-y-4">
            <legend className="mb-3 font-semibold">Quem recebe</legend>
            <Campo
              rotulo="Destinatário"
              value={dados.destinatario}
              onChange={(e) => alterar("destinatario", e.target.value)}
              required
              maxLength={160}
              autoComplete="off"
              erro={erros.destinatario}
            />
            <Campo
              rotulo="Telefone do destinatário (opcional)"
              value={dados.telefone}
              onChange={(e) => alterar("telefone", e.target.value)}
              maxLength={25}
              inputMode="tel"
              autoComplete="off"
              erro={erros.telefone}
            />
          </fieldset>
          <fieldset disabled={bloqueado} className="space-y-4">
            <legend className="mb-3 font-semibold">Endereço</legend>
            <Campo
              rotulo="Rua ou avenida"
              value={dados.endereco.logradouro}
              onChange={(e) => endereco("logradouro", e.target.value)}
              required
              maxLength={150}
              erro={erros["endereco.logradouro"]}
            />
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
              <Campo
                rotulo="Número"
                value={dados.endereco.numero}
                onChange={(e) => endereco("numero", e.target.value)}
                required
                maxLength={20}
                ajuda="Use S/N se não houver."
                erro={erros["endereco.numero"]}
              />
              <Campo
                rotulo="Complemento"
                value={dados.endereco.complemento}
                onChange={(e) => endereco("complemento", e.target.value)}
                maxLength={150}
                erro={erros["endereco.complemento"]}
              />
            </div>
            <Campo
              rotulo="Bairro"
              value={dados.endereco.bairro}
              onChange={(e) => endereco("bairro", e.target.value)}
              required
              maxLength={80}
              erro={erros["endereco.bairro"]}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-3">
              <Campo
                rotulo="Cidade"
                value={dados.endereco.cidade}
                onChange={(e) => endereco("cidade", e.target.value)}
                required
                maxLength={80}
                erro={erros["endereco.cidade"]}
              />
              <Campo
                rotulo="UF"
                value={dados.endereco.uf}
                onChange={(e) => endereco("uf", e.target.value.toUpperCase())}
                required
                minLength={2}
                maxLength={2}
                erro={erros["endereco.uf"]}
              />
            </div>
            <Campo
              rotulo="CEP (opcional)"
              value={dados.endereco.cep}
              onChange={(e) => endereco("cep", e.target.value)}
              maxLength={9}
              inputMode="numeric"
              erro={erros["endereco.cep"]}
            />
            <Campo
              rotulo="Referência (opcional)"
              value={dados.endereco.referencia}
              onChange={(e) => endereco("referencia", e.target.value)}
              maxLength={300}
              erro={erros["endereco.referencia"]}
            />
          </fieldset>
          <fieldset disabled={bloqueado} className="space-y-4">
            <legend className="mb-3 font-semibold">Frete e prazo</legend>
            <Botao
              type="button"
              peso="secundario"
              tamanho="pequeno"
              onClick={() => router.refresh()}
            >
              Atualizar áreas
            </Botao>
            <label className="text-ink-2 flex flex-col gap-1.5 text-sm font-semibold">
              Área de entrega
              <select
                value={areaId}
                onChange={(e) => selecionar(e.target.value)}
                className="border-line-2 bg-surface text-ink h-10 w-full rounded-md border px-3 font-normal"
              >
                <option value="">Frete manual</option>
                {areaId && !selecionada && (
                  <option value={areaId}>Área indisponível</option>
                )}
                {ativas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.nome} · {area.cidade}/{area.uf}
                  </option>
                ))}
              </select>
            </label>
            {selecionada && (
              <p className="bg-surface-2 text-ink-2 rounded-md p-3 text-sm">
                {selecionada.bairros.length
                  ? `Bairros atendidos: ${selecionada.bairros.join(", ")}.`
                  : `Todos os bairros de ${selecionada.cidade}/${selecionada.uf}.`}{" "}
                Frete e prazo serão conferidos novamente ao concluir.
              </p>
            )}
            {selecionada && versaoArea !== selecionada.versao && (
              <div className="bg-warn-sub text-warn space-y-2 rounded-md p-3 text-sm">
                <p>
                  A área mudou. Confira os valores atuais antes de confirmar.
                </p>
                <Botao
                  type="button"
                  peso="secundario"
                  tamanho="pequeno"
                  onClick={() => selecionar(areaId)}
                >
                  Aplicar valores atuais da área
                </Botao>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Campo
                rotulo="Frete (R$)"
                value={frete}
                onChange={(e) => {
                  setFrete(e.target.value);
                  setAlterado(true);
                }}
                inputMode="decimal"
                required
                readOnly={!!selecionada}
                erro={erros.freteCentavos}
              />
              <Campo
                rotulo="Prazo (minutos)"
                value={prazo}
                onChange={(e) => {
                  setPrazo(e.target.value);
                  setAlterado(true);
                }}
                type="number"
                min={1}
                max={1440}
                step={1}
                required
                readOnly={!!selecionada}
                erro={erros.prazoMinutos}
              />
            </div>
            {!areaId && (
              <Campo
                rotulo="Motivo do frete manual"
                value={dados.motivoFreteManual}
                onChange={(e) => alterar("motivoFreteManual", e.target.value)}
                required
                minLength={3}
                maxLength={300}
                erro={erros.motivoFreteManual}
                ajuda="Justifique também quando o frete for grátis."
              />
            )}
          </fieldset>
          {erro && (
            <p
              role="alert"
              className="bg-bad-sub text-bad rounded-md p-3 text-sm"
            >
              {erro}
            </p>
          )}
        </form>
      </PainelLateral>
      {gerenciarEnderecos && cliente && (
        <EnderecosCliente
          key={`${unidadeId}:${cliente.id}`}
          unidadeId={unidadeId}
          cliente={cliente}
          podeEditar={podeEditarClientes}
          sugestao={
            esquemaEnderecoEntrega.safeParse(dados.endereco).success
              ? esquemaEnderecoEntrega.parse(dados.endereco)
              : undefined
          }
          aoFechar={() => setGerenciarEnderecos(false)}
          aoUsar={(item) => {
            setDados((atual) => ({
              ...atual,
              destinatario: cliente.nome,
              telefone: cliente.telefone ?? "",
              endereco: structuredClone(item.endereco),
              motivoFreteManual: "",
            }));
            setAreaId("");
            setVersaoArea(undefined);
            setFrete("0,00");
            setPrazo("30");
            setAlterado(true);
            setErros({});
            setErro("");
            setGerenciarEnderecos(false);
          }}
        />
      )}
    </>
  );
}

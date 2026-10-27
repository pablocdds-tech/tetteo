"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import { salvarEntregadorAcao } from "../acoes-entregas";
import type { Entregador } from "../entrega-types";
import { esquemaEntregador } from "../schemas/entrega";
import styles from "./entregas-admin.module.css";

export function AdminEntregadores({
  entregadores,
}: {
  entregadores: Entregador[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("TODOS");
  const [edicao, setEdicao] = useState<Entregador | "NOVO" | null>(null);
  const [mensagem, setMensagem] = useState("");
  const filtrados = entregadores.filter(
    (entregador) =>
      `${entregador.nome} ${entregador.telefone}`
        .toLocaleLowerCase("pt-BR")
        .includes(busca.trim().toLocaleLowerCase("pt-BR")) &&
      (situacao === "TODOS" ||
        (situacao === "ATIVOS" ? entregador.ativo : !entregador.ativo)),
  );
  return (
    <div className={styles.pagina}>
      <header className={styles.cabecalho}>
        <div>
          <h1>Entregadores</h1>
          <p>
            Cadastre quem faz as entregas desta unidade e mantenha os contatos
            atualizados.
          </p>
        </div>
        <Botao
          onClick={() => {
            setMensagem("");
            setEdicao("NOVO");
          }}
        >
          Novo entregador
        </Botao>
      </header>
      {mensagem && (
        <p role="status" className="bg-ok-sub text-ok rounded-md p-3 text-sm">
          {mensagem}
        </p>
      )}
      <div className={styles.filtros}>
        <Campo
          rotulo="Buscar entregador ou telefone"
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <label>
          Situação
          <select
            value={situacao}
            onChange={(e) => setSituacao(e.target.value)}
          >
            <option value="TODOS">Todos</option>
            <option value="ATIVOS">Ativos</option>
            <option value="INATIVOS">Inativos</option>
          </select>
        </label>
      </div>
      <div className={styles.tabela}>
        <table>
          <thead>
            <tr>
              <th scope="col">Entregador</th>
              <th scope="col">Telefone</th>
              <th scope="col">Situação</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((entregador) => (
              <tr key={entregador.id}>
                <th scope="row">{entregador.nome}</th>
                <td>{entregador.telefone || "Não informado"}</td>
                <td>
                  <span
                    className={`${styles.situacao} ${entregador.ativo ? styles.ativa : ""}`}
                  >
                    {entregador.ativo ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td>
                  <Botao
                    peso="fantasma"
                    tamanho="pequeno"
                    onClick={() => setEdicao(entregador)}
                    aria-label={`Editar entregador ${entregador.nome}`}
                  >
                    Editar
                  </Botao>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtrados.length && (
          <div className={styles.vazio}>
            <h2>
              {entregadores.length
                ? "Nenhum entregador neste filtro"
                : "Cadastre seu primeiro entregador"}
            </h2>
            <p>
              {entregadores.length
                ? "Tente outra busca ou situação."
                : "Os entregadores ativos poderão ser vinculados aos pedidos de entrega na gestão."}
            </p>
          </div>
        )}
      </div>
      <p className="text-ink-3 text-sm">
        {filtrados.length} de {entregadores.length} entregadores. Desativar
        preserva os vínculos e o histórico dos pedidos anteriores.
      </p>
      {edicao && (
        <EditorEntregador
          key={edicao === "NOVO" ? "novo" : `${edicao.id}:${edicao.versao}`}
          entregador={edicao === "NOVO" ? null : edicao}
          aoFechar={() => setEdicao(null)}
          aoSalvar={(texto) => {
            setEdicao(null);
            setMensagem(texto);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EditorEntregador({
  entregador,
  aoFechar,
  aoSalvar,
}: {
  entregador: Entregador | null;
  aoFechar: () => void;
  aoSalvar: (texto: string) => void;
}) {
  const [nome, setNome] = useState(entregador?.nome ?? "");
  const [telefone, setTelefone] = useState(entregador?.telefone ?? "");
  const [ativo, setAtivo] = useState(entregador?.ativo ?? true);
  const [pendente, setPendente] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [erro, setErro] = useState("");
  const [id] = useState(() => entregador?.id ?? crypto.randomUUID());
  const trava = useRef(false);
  const tentativa = useRef<Omit<Entregador, "atualizadoEm"> | null>(null);
  function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (trava.current) return;
    if (!tentativa.current) {
      const validacao = esquemaEntregador.safeParse({
        id,
        versao: entregador?.versao ?? 0,
        nome,
        telefone,
        ativo,
      });
      if (!validacao.success) {
        setErro(
          "Informe um nome com pelo menos dois caracteres e um telefone brasileiro válido, ou deixe o telefone em branco.",
        );
        return;
      }
      tentativa.current = validacao.data;
    }
    trava.current = true;
    setPendente(true);
    setErro("");
    void (async () => {
      try {
        const resultado = await salvarEntregadorAcao(tentativa.current);
        if (resultado.erro) {
          setErro(resultado.erro);
          if (!incerta) tentativa.current = null;
          return;
        }
        if (!resultado.entregador) throw new Error("Sem confirmação");
        aoSalvar(resultado.ok ?? "Entregador salvo.");
      } catch {
        setIncerta(true);
        setErro(
          "A confirmação não chegou. Confirme novamente para consultar a mesma tentativa, sem criar outro entregador.",
        );
      } finally {
        trava.current = false;
        setPendente(false);
      }
    })();
  }
  return (
    <PainelLateral
      aberto
      aoFechar={aoFechar}
      podeFechar={() => !pendente && !incerta}
      titulo={entregador ? "Editar entregador" : "Novo entregador"}
      apoio="Cadastro por unidade. Não envia mensagens nem solicita acesso a outros aplicativos."
      rodape={
        <>
          <Botao
            peso="secundario"
            disabled={pendente || incerta}
            onClick={aoFechar}
          >
            Voltar
          </Botao>
          <Botao form="entregador-pdv" type="submit" carregando={pendente}>
            {incerta ? "Confirmar tentativa" : "Salvar entregador"}
          </Botao>
        </>
      }
    >
      <form id="entregador-pdv" onSubmit={salvar} className="space-y-4">
        <fieldset disabled={pendente || incerta} className="space-y-4">
          <Campo
            rotulo="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            maxLength={100}
          />
          <Campo
            rotulo="Telefone (opcional)"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            inputMode="tel"
            maxLength={25}
            ajuda="Informe DDD e número."
          />
          <label className="text-ink-2 flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
            />
            Ativo para novas entregas
          </label>
        </fieldset>
        {erro && (
          <p
            role="alert"
            className="bg-bad-sub text-bad rounded-md p-3 text-sm"
          >
            {erro}
          </p>
        )}
        {incerta && (
          <a
            href="/pdv/entregas/entregadores"
            target="_blank"
            rel="noopener"
            className="text-accent text-sm underline"
          >
            Consultar entregadores em outra aba
          </a>
        )}
      </form>
    </PainelLateral>
  );
}

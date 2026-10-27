"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import { PainelLateral } from "@/design-system/painel-lateral";
import { lerNumeroBr } from "@/lib/numero";
import { salvarAreaEntregaAcao } from "../acoes-entregas";
import type { AreaEntrega } from "../entrega-types";
import { esquemaAreaEntrega, UFS_ENTREGA } from "../schemas/entrega";
import styles from "./entregas-admin.module.css";

const moeda = (valor: number) =>
  (valor / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
type EntradaArea = Omit<AreaEntrega, "atualizadoEm">;

export function AdminAreasEntrega({ areas }: { areas: AreaEntrega[] }) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("TODAS");
  const [edicao, setEdicao] = useState<AreaEntrega | "NOVA" | null>(null);
  const [mensagem, setMensagem] = useState("");
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = areas.filter(
    (area) =>
      `${area.nome} ${area.cidade} ${area.uf} ${area.bairros.join(" ")}`
        .toLocaleLowerCase("pt-BR")
        .includes(termo) &&
      (situacao === "TODAS" ||
        (situacao === "ATIVAS" ? area.ativa : !area.ativa)),
  );
  return (
    <div className={styles.pagina}>
      <header className={styles.cabecalho}>
        <div>
          <h1>Áreas de entrega</h1>
          <p>
            Defina os bairros atendidos, o frete e o prazo de cada região desta
            unidade.
          </p>
        </div>
        <Botao
          onClick={() => {
            setMensagem("");
            setEdicao("NOVA");
          }}
        >
          Nova área
        </Botao>
      </header>
      {mensagem && (
        <p role="status" className="bg-ok-sub text-ok rounded-md p-3 text-sm">
          {mensagem}
        </p>
      )}
      <div className={styles.filtros}>
        <Campo
          rotulo="Buscar área, cidade ou bairro"
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
            <option value="TODAS">Todas</option>
            <option value="ATIVAS">Ativas</option>
            <option value="INATIVAS">Inativas</option>
          </select>
        </label>
      </div>
      <div className={styles.tabela}>
        <table>
          <thead>
            <tr>
              <th scope="col">Área</th>
              <th scope="col">Cobertura</th>
              <th scope="col">Frete</th>
              <th scope="col">Prazo</th>
              <th scope="col">Situação</th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((area) => (
              <tr key={area.id}>
                <th scope="row">{area.nome}</th>
                <td>
                  <span>
                    {area.cidade}/{area.uf}
                  </span>
                  <small>
                    {area.bairros.length
                      ? area.bairros.join(", ")
                      : "Todos os bairros desta cidade"}
                  </small>
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {moeda(area.freteCentavos)}
                </td>
                <td className="whitespace-nowrap">{area.prazoMinutos} min</td>
                <td>
                  <span
                    className={`${styles.situacao} ${area.ativa ? styles.ativa : ""}`}
                  >
                    {area.ativa ? "Ativa" : "Inativa"}
                  </span>
                </td>
                <td>
                  <Botao
                    peso="fantasma"
                    tamanho="pequeno"
                    onClick={() => setEdicao(area)}
                    aria-label={`Editar área ${area.nome}`}
                  >
                    Editar
                  </Botao>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtradas.length && (
          <div className={styles.vazio}>
            <h2>
              {areas.length
                ? "Nenhuma área neste filtro"
                : "Cadastre sua primeira área de entrega"}
            </h2>
            <p>
              {areas.length
                ? "Tente outra busca ou situação."
                : "Use cidade, UF e bairros para que o caixa confira a região do endereço. Deixar os bairros vazios atende toda a cidade informada."}
            </p>
          </div>
        )}
      </div>
      <p className="text-ink-3 text-sm">
        {filtradas.length} de {areas.length} áreas. Desative uma área para
        retirá-la das novas vendas; os pedidos anteriores preservam o frete
        registrado.
      </p>
      {edicao && (
        <EditorArea
          key={edicao === "NOVA" ? "nova" : `${edicao.id}:${edicao.versao}`}
          area={edicao === "NOVA" ? null : edicao}
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

function EditorArea({
  area,
  aoFechar,
  aoSalvar,
}: {
  area: AreaEntrega | null;
  aoFechar: () => void;
  aoSalvar: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(area?.nome ?? "");
  const [cidade, setCidade] = useState(area?.cidade ?? "");
  const [uf, setUf] = useState(area?.uf ?? "");
  const [bairros, setBairros] = useState(area?.bairros.join("\n") ?? "");
  const [frete, setFrete] = useState(
    ((area?.freteCentavos ?? 0) / 100).toFixed(2).replace(".", ","),
  );
  const [prazo, setPrazo] = useState(String(area?.prazoMinutos ?? 30));
  const [ativa, setAtiva] = useState(area?.ativa ?? true);
  const [pendente, setPendente] = useState(false);
  const [incerta, setIncerta] = useState(false);
  const [erro, setErro] = useState("");
  const trava = useRef(false);
  const tentativa = useRef<EntradaArea | null>(null);
  const [id] = useState(() => area?.id ?? crypto.randomUUID());
  function salvar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (trava.current) return;
    if (!tentativa.current) {
      const valor = lerNumeroBr(frete);
      const centavos =
        typeof valor === "number" ? Math.round(valor * 100) : NaN;
      if (
        !Number.isSafeInteger(centavos) ||
        centavos < 0 ||
        (typeof valor === "number" &&
          Math.abs(valor * 100 - centavos) > 0.00001)
      ) {
        setErro("Informe um frete válido com até duas casas decimais.");
        return;
      }
      const validacao = esquemaAreaEntrega.safeParse({
        id,
        versao: area?.versao ?? 0,
        nome,
        cidade,
        uf,
        bairros: bairros
          .split(/\r?\n/)
          .map((bairro) => bairro.trim())
          .filter(Boolean),
        freteCentavos: centavos,
        prazoMinutos: Number(prazo),
        ativa,
      });
      if (!validacao.success) {
        setErro(
          validacao.error.issues.some((item) =>
            item.message.includes("repetidos"),
          )
            ? "Há bairros repetidos nesta área. Informe cada bairro uma única vez."
            : "Confira nome, cidade, UF, bairros e prazo entre 1 e 1440 minutos.",
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
        const resultado = await salvarAreaEntregaAcao(tentativa.current);
        if (resultado.erro) {
          setErro(resultado.erro);
          if (!incerta) tentativa.current = null;
          return;
        }
        if (!resultado.area) throw new Error("Sem confirmação");
        aoSalvar(resultado.ok ?? "Área de entrega salva.");
      } catch {
        setIncerta(true);
        setErro(
          "A confirmação não chegou. Confirme novamente para consultar a mesma tentativa, sem criar outra área.",
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
      titulo={area ? "Editar área de entrega" : "Nova área de entrega"}
      apoio="O frete é conferido no servidor ao concluir a venda."
      rodape={
        <>
          <Botao
            peso="secundario"
            disabled={pendente || incerta}
            onClick={aoFechar}
          >
            Voltar
          </Botao>
          <Botao type="submit" form="area-entrega-pdv" carregando={pendente}>
            {incerta ? "Confirmar tentativa" : "Salvar área"}
          </Botao>
        </>
      }
    >
      <form id="area-entrega-pdv" onSubmit={salvar} className="space-y-4">
        <fieldset disabled={pendente || incerta} className="space-y-4">
          <Campo
            rotulo="Nome da área"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            minLength={2}
            maxLength={100}
            placeholder="Ex.: Região central"
          />
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
            <Campo
              rotulo="Cidade"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
              required
              minLength={2}
              maxLength={80}
            />
            <label className={styles.campo}>
              UF
              <select
                value={uf}
                onChange={(e) => setUf(e.target.value as typeof uf)}
                required
              >
                <option value="">UF</option>
                {UFS_ENTREGA.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={styles.campo}>
            Bairros atendidos
            <textarea
              value={bairros}
              onChange={(e) => setBairros(e.target.value)}
              rows={5}
              maxLength={8100}
              placeholder="Um bairro por linha"
            />
            <span>
              Deixe vazio para atender todos os bairros desta cidade e UF.
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Campo
              rotulo="Frete (R$)"
              value={frete}
              onChange={(e) => setFrete(e.target.value)}
              inputMode="decimal"
              required
            />
            <Campo
              rotulo="Prazo (minutos)"
              type="number"
              min={1}
              max={1440}
              step={1}
              value={prazo}
              onChange={(e) => setPrazo(e.target.value)}
              required
            />
          </div>
          <label className="text-ink-2 flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={ativa}
              onChange={(e) => setAtiva(e.target.checked)}
            />
            Área ativa para novas vendas
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
            className="text-accent text-sm underline"
            href="/pdv/entregas/areas"
            target="_blank"
            rel="noopener"
          >
            Consultar áreas em outra aba
          </a>
        )}
      </form>
    </PainelLateral>
  );
}

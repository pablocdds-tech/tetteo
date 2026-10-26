"use client";

import {
  useActionState,
  useState,
  useRef,
  useEffect,
  startTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { Botao } from "@/design-system/botao";
import { Campo } from "@/design-system/campo";
import {
  empresaBancariaAcao,
  contaBancariaAcao,
  transferenciaBancariaAcao,
  estornoBancarioAcao,
  type EstadoBanco,
} from "../acoes-bancos";

const select =
  "border-line-2 bg-surface text-ink focus:border-accent h-10 w-full rounded-md border px-3 text-base focus:outline-2 focus:outline-accent focus:outline-offset-2 disabled:bg-surface-2";
const form =
  "border-line bg-surface mt-4 grid gap-4 rounded-xl border p-4 sm:p-5";
export type EmpresaBanco = {
  id: string;
  nome: string;
  cnpj: string;
  ativa: boolean;
};
export type ContaBanco = {
  id: string;
  nome: string;
  empresaId: string | null;
  modalidade: string | null;
  banco: string | null;
  agencia: string | null;
  numero: string | null;
  titularidade: string | null;
  nomeTitular: string | null;
  cor: string;
  saldoInicial: string;
  dataInicial: string;
  ativa: boolean;
  compensacao: boolean;
  versao: number;
};

function Escolha({
  rotulo,
  name,
  children,
  ...props
}: { rotulo: string; name: string; children: ReactNode } & Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  "name"
>) {
  return (
    <label className="text-ink-2 flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
      {rotulo}
      <select name={name} className={select} {...props}>
        {children}
      </select>
    </label>
  );
}
function Retorno({ estado }: { estado: EstadoBanco }) {
  return (
    <div aria-live="polite">
      {estado.erro && (
        <p role="alert" className="bg-bad-sub text-bad rounded-md p-3 text-sm">
          {estado.erro}
        </p>
      )}
      {estado.ok && (
        <p role="status" className="bg-ok-sub text-ok rounded-md p-3 text-sm">
          {estado.ok}
        </p>
      )}
    </div>
  );
}

/** Erros preservam o preenchimento; somente um sucesso limpa cadastros novos. */
function useFormularioBanco(
  acaoServidor: typeof contaBancariaAcao,
  limpar: boolean,
) {
  const [estado, acao, pendente] = useActionState(acaoServidor, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (estado.ok && limpar && ref.current) {
      const origem = ref.current.elements.namedItem("origemId");
      const valorOrigem =
        origem instanceof HTMLSelectElement ? origem.value : "";
      ref.current.reset();
      if (origem instanceof HTMLSelectElement) origem.value = valorOrigem;
    }
  }, [estado, limpar]);
  const enviar = (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    startTransition(() => acao(dados));
  };
  return { estado, acao, pendente, ref, enviar };
}

export function FormEmpresaBanco({
  empresa,
}: {
  empresa?: EmpresaBanco & {
    razaoSocial: string;
    regime: string;
    emiteNota: boolean;
    assinatura: string;
  };
} = {}) {
  const { estado, acao, pendente, ref, enviar } = useFormularioBanco(
    empresaBancariaAcao,
    !empresa,
  );
  return (
    <form action={acao} onSubmit={enviar} ref={ref} className={form}>
      {empresa && (
        <>
          <input type="hidden" name="id" value={empresa.id} />
          <input type="hidden" name="assinatura" value={empresa.assinatura} />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          name="nome"
          rotulo="Nome da empresa"
          defaultValue={empresa?.nome}
          required
          maxLength={80}
          placeholder="Como você identifica este CNPJ"
        />
        <Campo
          name="cnpj"
          rotulo="CNPJ"
          defaultValue={empresa?.cnpj}
          readOnly={Boolean(empresa)}
          required
          inputMode="numeric"
          maxLength={18}
        />
      </div>
      <Campo
        name="razaoSocial"
        rotulo="Razão social"
        defaultValue={empresa?.razaoSocial}
        required
        maxLength={140}
      />
      <Escolha
        name="regime"
        rotulo="Regime tributário atual"
        defaultValue={empresa?.regime ?? "DESCONHECIDO"}
      >
        <option value="DESCONHECIDO">A confirmar com a contabilidade</option>
        <option value="SIMPLES">Simples Nacional</option>
        <option value="LUCRO_PRESUMIDO">Lucro Presumido</option>
        <option value="LUCRO_PRESUMIDO_RETORNO_SIMPLES">
          Lucro Presumido · retorno ao Simples em andamento
        </option>
        <option value="LUCRO_REAL">Lucro Real</option>
      </Escolha>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="emiteNota"
          className="mt-1"
          defaultChecked={empresa?.emiteNota}
        />
        Este é o CNPJ que emite as notas na operação integrada ao Saipos.
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="ativa"
          defaultChecked={empresa?.ativa ?? true}
        />
        Empresa ativa
      </label>
      <Retorno estado={estado} />
      <div>
        <Botao peso="secundario" type="submit" carregando={pendente}>
          {empresa ? "Salvar empresa" : "Cadastrar empresa"}
        </Botao>
      </div>
    </form>
  );
}

export function FormContaBanco({
  empresas,
  conta,
  hoje,
}: {
  empresas: EmpresaBanco[];
  conta?: ContaBanco;
  hoje: string;
}) {
  const { estado, acao, pendente, ref, enviar } = useFormularioBanco(
    contaBancariaAcao,
    !conta,
  );
  return (
    <form action={acao} onSubmit={enviar} ref={ref} className={form}>
      {conta && (
        <>
          <input type="hidden" name="id" value={conta.id} />
          <input type="hidden" name="versao" value={conta.versao} />
        </>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          name="nome"
          rotulo="Nome da conta"
          defaultValue={conta?.nome}
          placeholder="Ex.: Santander · empresa 1"
          required
          maxLength={60}
        />
        <Escolha
          name="empresaId"
          rotulo="CNPJ responsável"
          defaultValue={conta?.empresaId ?? ""}
          required
        >
          <option value="">Escolha a empresa</option>
          {empresas
            .filter((e) => e.ativa || e.id === conta?.empresaId)
            .map((e) => (
              <option value={e.id} key={e.id}>
                {e.nome} · {e.cnpj}
              </option>
            ))}
        </Escolha>
        <Escolha
          name="modalidade"
          rotulo="Tipo de conta"
          defaultValue={conta?.modalidade ?? "CORRENTE"}
        >
          <option value="CORRENTE">Conta corrente</option>
          <option value="POUPANCA">Poupança</option>
          <option value="DINHEIRO">Dinheiro / caixa físico</option>
          <option value="APLICACAO">Aplicação</option>
          <option value="OUTRO">Outro / compensação</option>
        </Escolha>
        <Campo
          name="banco"
          rotulo="Banco"
          defaultValue={conta?.banco ?? ""}
          placeholder="Santander, PagBank, Cappta…"
          maxLength={80}
          list="bancos-conhecidos"
        />
        <Campo
          name="agencia"
          rotulo="Agência"
          defaultValue={conta?.agencia ?? ""}
          maxLength={30}
          autoComplete="off"
        />
        <Campo
          name="numero"
          rotulo="Número da conta com dígito"
          defaultValue={conta?.numero ?? ""}
          maxLength={40}
          autoComplete="off"
        />
        <Escolha
          name="titularidade"
          rotulo="Titularidade"
          defaultValue={conta?.titularidade ?? "PJ"}
        >
          <option value="PJ">Pessoa jurídica</option>
          <option value="PF">Pessoa física usada pela loja</option>
        </Escolha>
        <Campo
          name="nomeTitular"
          rotulo="Nome do titular"
          defaultValue={conta?.nomeTitular ?? ""}
          required
          maxLength={140}
          ajuda="O CNPJ responsável acima identifica o uso pela operação."
        />
        <Campo
          name="saldoInicial"
          rotulo="Saldo de abertura"
          defaultValue={
            conta
              ? Number(conta.saldoInicial).toFixed(2).replace(".", ",")
              : "0,00"
          }
          inputMode="decimal"
          required
          ajuda="Saldo antes dos movimentos da data inicial."
        />
        <Campo
          name="dataInicial"
          rotulo="Data inicial"
          type="date"
          defaultValue={conta?.dataInicial ?? hoje}
          min="2000-01-01"
          max={hoje}
          required
        />
        <Campo
          name="cor"
          rotulo="Cor da conta"
          type="color"
          defaultValue={conta?.cor ?? "#0066cc"}
        />
      </div>
      <datalist id="bancos-conhecidos">
        <option value="Santander" />
        <option value="PagBank" />
        <option value="Cappta" />
      </datalist>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="compensacao"
          defaultChecked={conta?.compensacao}
          className="mt-1"
        />
        Conta de compensação entre empresas (tipo Outro, PJ, sem agência/número
        e abertura zero).
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="ativa"
          defaultChecked={conta?.ativa ?? true}
        />
        Conta ativa
      </label>
      <p className="text-ink-3 text-sm">
        Depois de movimentar, saldo e dados bancários ficam protegidos. Para
        corrigir uma transferência, registre um estorno.
      </p>
      <Retorno estado={estado} />
      <div>
        <Botao
          type="submit"
          peso="secundario"
          carregando={pendente}
          disabled={empresas.length === 0}
        >
          Salvar conta
        </Botao>
      </div>
    </form>
  );
}

export function FormTransferenciaBanco({
  contas,
  hoje,
  chave,
}: {
  contas: (Pick<ContaBanco, "id" | "nome" | "empresaId" | "ativa"> & {
    empresaNome: string;
  })[];
  hoje: string;
  chave: string;
}) {
  const { estado, acao, pendente, ref, enviar } = useFormularioBanco(
    transferenciaBancariaAcao,
    true,
  );
  const [origem, setOrigem] = useState("");
  const fonte = contas.find((c) => c.id === origem);
  const destinos = contas.filter(
    (c) => c.ativa && c.id !== origem && c.empresaId === fonte?.empresaId,
  );
  return (
    <form action={acao} onSubmit={enviar} ref={ref} className={form}>
      <input type="hidden" name="chave" value={estado.proximaChave ?? chave} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Escolha
          name="origemId"
          rotulo="Sai de"
          value={origem}
          onChange={(e) => setOrigem(e.target.value)}
          required
        >
          <option value="">Escolha a origem</option>
          {contas
            .filter((c) => c.ativa && c.empresaId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} · {c.empresaNome}
              </option>
            ))}
        </Escolha>
        <Escolha
          key={origem}
          name="destinoId"
          rotulo="Entra em"
          defaultValue=""
          required
          disabled={!fonte}
        >
          <option value="">Escolha o destino no mesmo CNPJ</option>
          {destinos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Escolha>
        <Campo
          name="valor"
          rotulo="Valor"
          inputMode="decimal"
          placeholder="0,00"
          required
        />
        <Campo
          name="data"
          rotulo="Data da transferência"
          type="date"
          defaultValue={hoje}
          max={hoje}
          min="2000-01-01"
          required
        />
      </div>
      <Campo
        name="descricao"
        rotulo="Descrição"
        placeholder="Ex.: Envio das vendas para a conta principal"
        maxLength={200}
        minLength={3}
        required
      />
      <p className="text-ink-3 text-sm">
        Atualiza os dois extratos e não entra no DRE. Para outro CNPJ, use
        compensação e registre o repasse a pagar/receber.
      </p>
      <Retorno estado={estado} />
      <div>
        <Botao
          type="submit"
          carregando={pendente}
          disabled={contas.filter((c) => c.ativa && c.empresaId).length < 2}
        >
          Registrar transferência
        </Botao>
      </div>
    </form>
  );
}

export function FormEstornoBanco({
  id,
  hoje,
  chave,
}: {
  id: string;
  hoje: string;
  chave: string;
}) {
  const { estado, acao, pendente, ref, enviar } = useFormularioBanco(
    estornoBancarioAcao,
    false,
  );
  return (
    <form action={acao} onSubmit={enviar} ref={ref} className="mt-3 grid gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="chave" value={chave} />
      <Campo
        name="data"
        rotulo="Data do estorno"
        type="date"
        defaultValue={hoje}
        max={hoje}
        required
      />
      <Campo
        name="motivo"
        rotulo="Motivo do estorno"
        minLength={3}
        maxLength={160}
        required
      />
      <Retorno estado={estado} />
      <div>
        <Botao
          type="submit"
          peso="secundario"
          tamanho="pequeno"
          carregando={pendente}
          disabled={Boolean(estado.ok)}
        >
          Confirmar estorno
        </Botao>
      </div>
    </form>
  );
}

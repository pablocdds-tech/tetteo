import type { DetalheCaixa, FormaCaixa, TotaisCaixa } from "../caixa-types";
import {
  codigoCaixa,
  dataCaixa,
  formasCaixa,
  modalidadesCaixa,
  moedaCaixa,
} from "../caixa-types";
import styles from "./gestao-caixa.module.css";

function Linha({
  nome,
  valor,
  destaque = false,
}: {
  nome: string;
  valor: number;
  destaque?: boolean;
}) {
  return (
    <div className={destaque ? styles.totalResumo : undefined}>
      <dt>{nome}</dt>
      <dd>{moedaCaixa(valor)}</dd>
    </div>
  );
}
function Pagamentos({ totais }: { totais: TotaisCaixa }) {
  return (
    <>
      {(Object.entries(formasCaixa) as [FormaCaixa, string][])
        .filter(([forma]) => totais.pagamentos[forma] !== 0)
        .map(([forma, nome]) => (
          <Linha key={forma} nome={nome} valor={totais.pagamentos[forma]} />
        ))}
    </>
  );
}
export function ResumoCaixa({ caixa }: { caixa: DetalheCaixa }) {
  return (
    <div className={styles.corpoResumo}>
      <div className={styles.sessao}>
        <span>
          <strong>Sessão</strong> {codigoCaixa(caixa.id)}
        </span>
        <span className={styles.situacao} data-fechado={!!caixa.fechadoEm}>
          {caixa.fechadoEm ? "Fechado" : "Aberto"}
        </span>
      </div>
      <div className={styles.dadosSessao}>
        <strong>Aberto em</strong>
        <span>{dataCaixa(caixa.abertoEm)}</span>
        <span>Por {caixa.operador}</span>
        {caixa.fechadoEm && (
          <>
            <strong>Fechado em</strong>
            <span>{dataCaixa(caixa.fechadoEm)}</span>
          </>
        )}
      </div>
      <section>
        <h3>Resumo do caixa</h3>
        <dl>
          <Linha nome="Saldo inicial" valor={caixa.saldoInicialCentavos} />
          <Linha nome="Suprimentos" valor={caixa.suprimentosCentavos} />
          <Linha nome="Sangrias" valor={-caixa.sangriasCentavos} />
          <Linha
            nome="Vendas em dinheiro"
            valor={caixa.resumo.pagamentos.DINHEIRO}
          />
          <Linha
            nome="Valor em caixa"
            valor={caixa.saldoEsperadoCentavos}
            destaque
          />
          {caixa.valorContadoCentavos !== null && (
            <>
              <Linha
                nome="Dinheiro conferido"
                valor={caixa.valorContadoCentavos}
              />
              <Linha
                nome="Diferença"
                valor={caixa.diferencaCentavos ?? 0}
                destaque
              />
            </>
          )}
        </dl>
      </section>
      <section>
        <h3>Resumo das vendas</h3>
        <dl>
          <Pagamentos totais={caixa.resumo} />
          <Linha nome="Total" valor={caixa.resumo.totalCentavos} destaque />
        </dl>
      </section>
      {caixa.modalidades.map(({ modalidade, totais }) => (
        <section key={modalidade}>
          <h3>Vendas {modalidadesCaixa[modalidade] ?? modalidade}</h3>
          <dl>
            <Pagamentos totais={totais} />
            <div className={styles.separadorResumo} />
            <Linha nome="Valor dos produtos" valor={totais.subtotalCentavos} />
            {!!totais.freteCentavos && (
              <Linha nome="Taxas de entrega" valor={totais.freteCentavos} />
            )}
            {!!totais.taxaCentavos && (
              <Linha nome="Acréscimos" valor={totais.taxaCentavos} />
            )}
            {!!totais.descontoCentavos && (
              <Linha nome="Descontos" valor={-totais.descontoCentavos} />
            )}
            <Linha nome="Total" valor={totais.totalCentavos} destaque />
          </dl>
        </section>
      ))}
      {caixa.observacao && (
        <section>
          <h3>Observações do fechamento</h3>
          <p className={styles.observacao}>{caixa.observacao}</p>
        </section>
      )}
    </div>
  );
}

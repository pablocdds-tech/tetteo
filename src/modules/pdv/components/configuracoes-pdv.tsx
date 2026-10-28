"use client";
import { useState, useSyncExternalStore } from "react";
import {
  LinkIntegrado as Link,
  useAmbienteProprio,
} from "@/core/shell/link-integrado";
import { useLayoutPedidos } from "../hooks/use-layout-pedidos";
import {
  ESTADOS_OCULTAVEIS,
  LAYOUT_PEDIDOS_PADRAO,
} from "../schemas/layout-pedidos";
import { ROTULO_PEDIDO, STATUS_PEDIDO } from "../schemas/pedido";
import comum from "./secoes-pdv.module.css";
import styles from "./configuracoes-pdv.module.css";

const abas = ["Geral", "Impressão", "Agendamento", "Integrações"] as const;
const observarProntidao = () => () => {};
const noCliente = () => true;
const noServidor = () => false;
export function ConfiguracoesPdv({
  preferenciasId,
}: {
  preferenciasId: string;
}) {
  const proprio = useAmbienteProprio();
  const [aba, setAba] = useState<(typeof abas)[number]>("Geral");
  const [layout, alterar] = useLayoutPedidos(preferenciasId);
  const pronto = useSyncExternalStore(observarProntidao, noCliente, noServidor);
  return (
    <div className={comum.pagina}>
      <h1 className={proprio ? "sr-only" : comum.titulo}>Configurações</h1>
      <div className={styles.painel}>
        <nav aria-label="Seções de configurações" className={styles.menu}>
          {abas.map((nome) => (
            <button
              key={nome}
              aria-pressed={aba === nome}
              onClick={() => setAba(nome)}
            >
              {nome}
            </button>
          ))}
          <Link href="/pdv/preparacao">Preparar operação</Link>
        </nav>
        <section className={styles.conteudo} aria-label={aba}>
          {aba === "Geral" && (
            <>
              <h2>Gestão de pedidos</h2>
              <p className={comum.legenda}>
                Preferências deste operador e unidade neste navegador. As
                alterações são aplicadas automaticamente à gestão.
              </p>
              <div className={styles.linha}>
                <div>
                  <h3>Layout dos pedidos</h3>
                  <p>Escolha a disposição usada para acompanhar a operação.</p>
                </div>
                <select
                  aria-label="Layout dos pedidos"
                  disabled={!pronto}
                  value={layout.modo}
                  onChange={(e) =>
                    alterar((atual) => ({
                      ...atual,
                      modo: e.target.value as "LISTAS" | "KANBAN",
                    }))
                  }
                >
                  <option value="LISTAS">Duas listas</option>
                  <option value="KANBAN">Kanban por etapas</option>
                </select>
              </div>
              <h2>
                {layout.modo === "LISTAS"
                  ? "Distribuição das listas"
                  : "Etapas visíveis"}
              </h2>
              {STATUS_PEDIDO.map((status) => {
                const ocultavel = ESTADOS_OCULTAVEIS.some((e) => e === status);
                return (
                  <div className={styles.linha} key={status}>
                    <div>
                      <h3>{ROTULO_PEDIDO[status]}</h3>
                      <p>
                        {ocultavel
                          ? "Pode ser ocultado nesta apresentação."
                          : "Pedidos em andamento permanecem visíveis."}
                      </p>
                    </div>
                    {layout.modo === "LISTAS" ? (
                      <select
                        aria-label={"Lista de " + ROTULO_PEDIDO[status]}
                        disabled={!pronto}
                        value={layout.distribuicao[status]}
                        onChange={(e) =>
                          alterar((atual) => ({
                            ...atual,
                            distribuicao: {
                              ...atual.distribuicao,
                              [status]: e.target.value as "1" | "2" | "OCULTO",
                            },
                          }))
                        }
                      >
                        <option value="1">Lista 1</option>
                        <option value="2">Lista 2</option>
                        {ocultavel && <option value="OCULTO">Ocultar</option>}
                      </select>
                    ) : (
                      <label className={styles.chave}>
                        <input
                          type="checkbox"
                          aria-label={"Mostrar " + ROTULO_PEDIDO[status]}
                          checked={layout.visiveis.includes(status)}
                          disabled={!pronto || !ocultavel}
                          onChange={(e) =>
                            alterar((atual) => ({
                              ...atual,
                              visiveis: e.target.checked
                                ? [...atual.visiveis, status]
                                : atual.visiveis.filter((s) => s !== status),
                            }))
                          }
                        />
                        <span>
                          {layout.visiveis.includes(status)
                            ? "Visível"
                            : "Oculto"}
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}
              <div className={comum.acoes}>
                <button
                  className={comum.botao}
                  disabled={!pronto}
                  onClick={() => alterar(() => LAYOUT_PEDIDOS_PADRAO)}
                >
                  Restaurar layout padrão
                </button>
                <Link className={comum.primario} href="/pdv">
                  Abrir gestão
                </Link>
              </div>
              <h2>Cadastros da operação</h2>
              <div className={styles.linha}>
                <div>
                  <h3>Produtos e complementos</h3>
                  <p>Preços e receitas integrados ao cadastro do Tetteo.</p>
                </div>
                <Link className={comum.link} href="/pdv/catalogo">
                  Configurar
                </Link>
              </div>
              <div className={styles.linha}>
                <div>
                  <h3>Áreas de entrega</h3>
                  <p>Cidade, bairros, frete e prazo usados no atendimento.</p>
                </div>
                <Link className={comum.link} href="/pdv/entregas/areas">
                  Configurar
                </Link>
              </div>
            </>
          )}
          {aba === "Impressão" && (
            <>
              <h2>Impressão dos pedidos</h2>
              <div className={styles.linha}>
                <div>
                  <h3>Via do cliente e comanda da cozinha</h3>
                  <p>
                    Abra o pedido na gestão ou no histórico e selecione a via. A
                    prévia usa bobina de 80 mm; escolha a impressora na janela
                    de impressão do navegador.
                  </p>
                </div>
              </div>
              <div className={styles.linha}>
                <div>
                  <h3>Resumo do caixa</h3>
                  <p>
                    Imprima a conferência do caixa atual ou de um caixa
                    encerrado diretamente no resumo.
                  </p>
                </div>
                <Link className={comum.link} href="/pdv/caixa">
                  Abrir caixa
                </Link>
              </div>
              <p className={comum.legenda}>
                A impressão é manual. O registro da solicitação não confirma que
                o papel foi impresso.
              </p>
              <Link className={comum.primario} href="/pdv/vendas">
                Consultar pedidos
              </Link>
            </>
          )}
          {aba === "Agendamento" && (
            <>
              <h2>Pedidos agendados</h2>
              <div className={styles.linha}>
                <div>
                  <h3>Horário e antecedência de preparo</h3>
                  <p>
                    No novo pedido, escolha o horário de entrega ou retirada e a
                    antecedência para iniciar o preparo. A cozinha recebe o
                    pedido quando chega esse horário.
                  </p>
                </div>
              </div>
              <div className={styles.linha}>
                <div>
                  <h3>Acompanhar e reagendar</h3>
                  <p>
                    Todos os pedidos continuam na gestão. Use a visão Agendados
                    para conferir os horários, iniciar o preparo antecipadamente
                    ou reagendar com justificativa.
                  </p>
                </div>
              </div>
              <div className={comum.acoes}>
                <Link className={comum.primario} href="/pdv?visao=AGENDADOS">
                  Ver agendados
                </Link>
                <Link className={comum.botao} href="/pdv/novo-pedido">
                  Novo pedido
                </Link>
              </div>
            </>
          )}
          {aba === "Integrações" && (
            <>
              <h2>Integrações com o Tetteo</h2>
              <div className={styles.linha}>
                <div>
                  <h3>Clientes e endereços</h3>
                  <p>
                    O atendimento usa o CRM da unidade. Os endereços escolhidos
                    são preservados em cada pedido.
                  </p>
                </div>
                <Link className={comum.link} href="/pdv/clientes">
                  Clientes
                </Link>
              </div>
              <div className={styles.linha}>
                <div>
                  <h3>Cardápio Web e outras origens</h3>
                  <p>
                    As conexões são administradas no Tetteo. Pedidos recebidos
                    aparecem na gestão identificados pela origem.
                  </p>
                </div>
                <Link className={comum.link} href="/configuracoes/integracoes">
                  Gerenciar no Tetteo
                </Link>
              </div>
              <div className={styles.linha}>
                <div>
                  <h3>Estoque e receitas</h3>
                  <p>
                    Confira cadastros, locais e disponibilidade antes de abrir a
                    operação.
                  </p>
                </div>
                <Link className={comum.link} href="/pdv/preparacao">
                  Verificar operação
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

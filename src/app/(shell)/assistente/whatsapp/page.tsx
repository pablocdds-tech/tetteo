import { redirect } from "next/navigation";

import { lerConexaoParaTela } from "@/app/api/whatsapp/_costura/conexao-tela";
import { obterContexto, pode } from "@/core/sessao/contexto";
import { CabecalhoDePagina } from "@/design-system/cabecalho-de-pagina";
import { Cartao } from "@/design-system/cartao";
import { Vazio } from "@/design-system/vazio";
import { CadastrarConexao } from "@/modules/assistente/components/cadastrar-conexao";
import { PainelWhatsapp } from "@/modules/assistente/components/painel-whatsapp";
import { listarConexoes } from "@/modules/assistente/services/conexao";

import {
  aplicarEventosAcao,
  estadoDaConexaoAcao,
  reconectarAcao,
} from "../acoes-whatsapp";

/**
 * A TELA "WHATSAPP".
 *
 * A rota só costura: lê o estado pela camada `app/` (que alcança o conector)
 * e entrega ao painel do módulo as ações que falam com o provedor. O módulo
 * não importa o conector — e não precisa.
 */
export default async function PaginaWhatsapp() {
  const contexto = await obterContexto();
  if (!contexto) redirect("/login");
  if (!pode(contexto, "assistente.ver")) redirect("/assistente");

  const conexoes = await listarConexoes(contexto);
  const lojas = contexto.unidadesVisiveis.map((u) => ({
    id: u.id,
    nome: u.nome,
  }));

  return (
    <div className="mx-auto w-full max-w-5xl">
      <CabecalhoDePagina
        titulo="WhatsApp"
        contexto="O número, o que ele está fazendo, e o que pode sair por ele"
      />

      {conexoes.length === 0 ? (
        <Cartao className="mt-6">
          <Vazio
            icone="sem-sinal"
            titulo="Nenhum número cadastrado no Tetteo"
            explicacao={
              pode(contexto, "assistente.conectar")
                ? "Cadastre a instância que já existe na Evolution. Nada é criado lá, e o número conectado continua conectado."
                : "Um responsável precisa cadastrar a instância da Evolution."
            }
            acao={
              pode(contexto, "assistente.conectar") ? (
                <CadastrarConexao
                  nomeSugerido={process.env.EVOLUTION_INSTANCIA?.trim() ?? ""}
                  lojas={lojas}
                />
              ) : undefined
            }
          />
        </Cartao>
      ) : (
        conexoes.map(async (conexao) => {
          const tela = await lerConexaoParaTela(contexto, conexao.id);
          return (
            <PainelWhatsapp
              key={conexao.id}
              conexao={tela}
              lojas={lojas}
              reconectar={reconectarAcao}
              consultarEstado={estadoDaConexaoAcao}
              aplicarEventos={aplicarEventosAcao}
            />
          );
        })
      )}
    </div>
  );
}

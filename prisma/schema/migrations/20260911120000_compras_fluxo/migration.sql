-- ===========================================================================
-- COMPRAS: DO PEDIDO DA LOJA AO RECEBIMENTO  (10/09/2026)
--
-- Desenho: docs/superpowers/specs/2026-09-10-compras-fluxo-design.md
--
-- A cotação de 04/08 vira RODADA; a proposta vira SOLICITAÇÃO + VERSÃO; o
-- preço proposto vira ITEM DE PROPOSTA; o pedido ganha snapshot, sequência e
-- os estados de aprovação. Nenhuma tabela paralela: o que existia é
-- CONVERTIDO, com os mesmos ids, e só depois as tabelas antigas saem.
--
-- Tudo numa transação só. Se qualquer passo falhar, o banco fica exatamente
-- como estava — uma migração pela metade seria pior do que nenhuma.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------- 1. TIPOS

CREATE TYPE "EstadoRodada" AS ENUM ('RASCUNHO', 'COLETANDO', 'COTANDO', 'REVISAO', 'APROVADA', 'DESPACHANDO', 'FECHADA', 'CANCELADA');
CREATE TYPE "StatusRequisicao" AS ENUM ('RASCUNHO', 'ENVIADA', 'DEVOLVIDA');
CREATE TYPE "ModoDoItem" AS ENUM ('COTAVEL', 'DIRECIONADO');
CREATE TYPE "StatusSolicitacao" AS ENUM ('RASCUNHO', 'CONVIDADO', 'RESPONDIDA', 'RECUSOU', 'ENCERRADA_SEM_RESPOSTA', 'ENCERRADA');
CREATE TYPE "OrigemDaVersao" AS ENUM ('FORNECEDOR_LINK', 'COMPRADOR_DIGITOU', 'NEGOCIACAO');
CREATE TYPE "SituacaoDaOferta" AS ENUM ('COTADO', 'INDISPONIVEL');
CREATE TYPE "DecisaoDeAprovacao" AS ENUM ('APROVADO', 'RECUSADO');
CREATE TYPE "ConfirmacaoFornecedor" AS ENUM ('PENDENTE', 'CONFIRMADO', 'CONFIRMADO_COM_RESSALVA', 'RECUSADO');
CREATE TYPE "SituacaoRecebimento" AS ENUM ('NADA', 'PARCIAL', 'COMPLETO');
CREATE TYPE "TipoDePedido" AS ENUM ('PEDIDO', 'ADENDO');
CREATE TYPE "TipoDeAlteracao" AS ENUM ('ALTERACAO', 'CANCELAMENTO');
CREATE TYPE "Concordancia" AS ENUM ('PENDENTE', 'ACEITA', 'RECUSADA');
CREATE TYPE "TipoDeMensagem" AS ENUM ('CONVITE_COTACAO', 'PEDIDO', 'ADENDO', 'ALTERACAO', 'CANCELAMENTO', 'TESTE');
CREATE TYPE "EstadoDaMensagem" AS ENUM ('BLOQUEADA', 'NA_FILA', 'ENVIANDO', 'ACEITA_PELO_CANAL', 'ENTREGUE', 'INCERTA', 'FALHOU', 'CANCELADA');
CREATE TYPE "TipoDeRecebimento" AS ENUM ('ENTRADA', 'DEVOLUCAO');
CREATE TYPE "DecisaoDeConferencia" AS ENUM ('ACEITAR', 'RECUSAR');
CREATE TYPE "TipoDeDivergencia" AS ENUM ('FALTOU', 'EXCEDENTE', 'AVARIA', 'SUBSTITUICAO', 'SALDO_ENCERRADO', 'NOTA_QUANTIDADE', 'NOTA_VALOR', 'DEVOLUCAO');
CREATE TYPE "EstadoDaDivergencia" AS ENUM ('ABERTA', 'RESOLVIDA');

-- O valor novo não é usado nesta transação — por isso pode ser acrescentado
-- dentro dela (PostgreSQL 12+).
ALTER TYPE "TipoDeMovimento" ADD VALUE 'DEVOLUCAO';

-- ------------------------------------------------- 2. ESTOQUE, CORE, FORNECEDOR

ALTER TABLE "movimento_estoque" ADD COLUMN "recebimentoId" TEXT;

ALTER TABLE "nota_entrada" ADD COLUMN "pedidoId" TEXT,
ADD COLUMN "recebimentoId" TEXT;

ALTER TABLE "fornecedor" ADD COLUMN "autorizadoEm" TIMESTAMP(3),
ADD COLUMN "autorizadoMensagens" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "autorizadoPorId" TEXT,
ADD COLUMN "telefonePedidos" TEXT;

CREATE TABLE "arquivo" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "enviadoPorId" TEXT,
    "caminho" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "permissaoLeitura" TEXT NOT NULL,
    "entidade" TEXT,
    "entidadeId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluidoEm" TIMESTAMP(3),

    CONSTRAINT "arquivo_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------------------------- 3. TABELAS NOVAS

CREATE TABLE "fornecedor_insumo" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "nomeEmbalagem" TEXT NOT NULL,
    "pecas" INTEGER NOT NULL DEFAULT 1,
    "conteudo" DECIMAL(14,4),
    "unidadeConteudo" "UnidadeMedida",
    "fracionavel" BOOLEAN NOT NULL DEFAULT false,
    "fator" DECIMAL(14,4),
    "fatorOrigem" TEXT,
    "fatorVersao" INTEGER NOT NULL DEFAULT 1,
    "fixo" BOOLEAN NOT NULL DEFAULT false,
    "chaveFixo" TEXT,
    "precoReferencia" DECIMAL(14,2),
    "precoReferenciaOrigem" TEXT,
    "precoReferenciaEm" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "fornecedor_insumo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agenda_de_rodada" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "diaDaSemana" INTEGER NOT NULL,
    "horaAbertura" TEXT NOT NULL,
    "horasParaRequisicao" INTEGER NOT NULL DEFAULT 24,
    "horasParaCotacao" INTEGER NOT NULL DEFAULT 48,
    "entregaDeDias" INTEGER NOT NULL DEFAULT 2,
    "entregaAteDias" INTEGER NOT NULL DEFAULT 3,
    "unidadeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsavelId" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "agenda_de_rodada_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rodada_de_compra" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "descricao" TEXT NOT NULL,
    "estado" "EstadoRodada" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "prazoRequisicao" TIMESTAMP(3),
    "prazoCotacao" TIMESTAMP(3),
    "entregaDe" TIMESTAMP(3),
    "entregaAte" TIMESTAMP(3),
    "responsavelId" TEXT,
    "agendaId" TEXT,
    "ocorrencia" TEXT,
    "observacao" TEXT,
    "motivoUltimaReabertura" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,
    "consolidadaEm" TIMESTAMP(3),
    "cotacaoEncerradaEm" TIMESTAMP(3),
    "fechadaEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),

    CONSTRAINT "rodada_de_compra_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "requisicao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "rodadaId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "status" "StatusRequisicao" NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "observacao" TEXT,
    "enviadaEm" TIMESTAMP(3),
    "enviadaPorId" TEXT,
    "devolvidaEm" TIMESTAMP(3),
    "devolvidaPorId" TEXT,
    "motivoDevolucao" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "requisicao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_de_requisicao" (
    "id" TEXT NOT NULL,
    "requisicaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "embalagemPreferida" TEXT,
    "fatorConhecido" DECIMAL(14,4),
    "categoria" TEXT,
    "observacao" TEXT,
    "sugestaoQuantidade" DECIMAL(14,3),
    "sugestaoFormula" TEXT,
    "alertas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tardio" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "item_de_requisicao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_da_rodada" (
    "id" TEXT NOT NULL,
    "rodadaId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidadeTotal" DECIMAL(14,3) NOT NULL,
    "modo" "ModoDoItem" NOT NULL DEFAULT 'COTAVEL',
    "fornecedorFixoId" TEXT,
    "excecaoMotivo" TEXT,
    "excecaoPorId" TEXT,
    "excecaoEm" TIMESTAMP(3),
    "observacao" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "item_da_rodada_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "solicitacao_de_cotacao" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "rodadaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "status" "StatusSolicitacao" NOT NULL DEFAULT 'RASCUNHO',
    "prazo" TIMESTAMP(3),
    "tokenHash" TEXT,
    "tokenCifrado" TEXT,
    "tokenExpiraEm" TIMESTAMP(3),
    "tokenRevogadoEm" TIMESTAMP(3),
    "motivoRevogacao" TEXT,
    "tentativasInvalidas" INTEGER NOT NULL DEFAULT 0,
    "ultimoEnvioEm" TIMESTAMP(3),
    "convidadoEm" TIMESTAMP(3),
    "versaoAtual" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT,

    CONSTRAINT "solicitacao_de_cotacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_da_solicitacao" (
    "id" TEXT NOT NULL,
    "solicitacaoId" TEXT NOT NULL,
    "itemDaRodadaId" TEXT NOT NULL,
    "direcionado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "item_da_solicitacao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "versao_de_proposta" (
    "id" TEXT NOT NULL,
    "solicitacaoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "origem" "OrigemDaVersao" NOT NULL,
    "registradaPorId" TEXT,
    "motivo" TEXT,
    "frete" DECIMAL(14,2),
    "pedidoMinimo" DECIMAL(14,2),
    "prazoEntregaDias" INTEGER,
    "validaAte" TIMESTAMP(3),
    "observacao" TEXT,
    "recebidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versao_de_proposta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_de_proposta" (
    "id" TEXT NOT NULL,
    "versaoId" TEXT NOT NULL,
    "itemDaSolicitacaoId" TEXT NOT NULL,
    "situacao" "SituacaoDaOferta" NOT NULL,
    "nomeEmbalagem" TEXT,
    "pecas" INTEGER NOT NULL DEFAULT 1,
    "conteudo" DECIMAL(14,4),
    "unidadeConteudo" "UnidadeMedida",
    "fracionavel" BOOLEAN NOT NULL DEFAULT false,
    "fator" DECIMAL(14,4),
    "fatorMotivo" TEXT,
    "precoEmbalagem" DECIMAL(14,2),
    "precoUnitario" DECIMAL(14,6),
    "precoZeroAutorizado" BOOLEAN NOT NULL DEFAULT false,
    "precoZeroMotivo" TEXT,
    "precoZeroPorId" TEXT,
    "disponivel" DECIMAL(14,3),
    "observacao" TEXT,

    CONSTRAINT "item_de_proposta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "escolha_de_item" (
    "id" TEXT NOT NULL,
    "rodadaId" TEXT NOT NULL,
    "itemDaRodadaId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "itemDePropostaId" TEXT,
    "seguiuSugestao" BOOLEAN NOT NULL,
    "justificativa" TEXT,
    "escolhidaPorId" TEXT NOT NULL,
    "escolhidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escolha_de_item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alcada_de_compra" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "papelId" TEXT NOT NULL,
    "limite" DECIMAL(14,2),
    "versao" INTEGER NOT NULL,
    "chaveVigente" TEXT,
    "vigenteDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerradaEm" TIMESTAMP(3),
    "criadoPorId" TEXT,

    CONSTRAINT "alcada_de_compra_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "aprovacao_de_compra" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "aprovadorId" TEXT NOT NULL,
    "alcadaId" TEXT,
    "alcadaVersao" INTEGER,
    "valor" DECIMAL(14,2) NOT NULL,
    "decisao" "DecisaoDeAprovacao" NOT NULL,
    "motivo" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprovacao_de_compra_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alteracao_de_pedido" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "tipo" "TipoDeAlteracao" NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "concordancia" "Concordancia" NOT NULL DEFAULT 'PENDENTE',
    "concordanciaTexto" TEXT,
    "concordanciaEm" TIMESTAMP(3),
    "concordanciaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT,

    CONSTRAINT "alteracao_de_pedido_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_de_alteracao" (
    "id" TEXT NOT NULL,
    "alteracaoId" TEXT NOT NULL,
    "itemDePedidoId" TEXT NOT NULL,
    "embalagensAntes" DECIMAL(14,3) NOT NULL,
    "embalagensDepois" DECIMAL(14,3) NOT NULL,
    "quantidadeAntes" DECIMAL(14,3) NOT NULL,
    "quantidadeDepois" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "item_de_alteracao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "canal_de_compras" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "pausado" BOOLEAN NOT NULL DEFAULT false,
    "motivoPausa" TEXT,
    "pausadoPorId" TEXT,
    "pausadoEm" TIMESTAMP(3),
    "destinoTeste" TEXT,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canal_de_compras_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mensagem_ao_fornecedor" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "fornecedorId" TEXT,
    "tipo" "TipoDeMensagem" NOT NULL,
    "referenciaTipo" TEXT NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL DEFAULT 1,
    "destino" TEXT,
    "motivoBloqueio" TEXT,
    "canal" TEXT,
    "simulada" BOOLEAN NOT NULL DEFAULT false,
    "ehTeste" BOOLEAN NOT NULL DEFAULT false,
    "corpo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "estado" "EstadoDaMensagem" NOT NULL DEFAULT 'NA_FILA',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "maxTentativas" INTEGER NOT NULL DEFAULT 5,
    "proximaTentativaEm" TIMESTAMP(3),
    "leaseAte" TIMESTAMP(3),
    "leaseDono" TEXT,
    "ultimoErro" TEXT,
    "idProvedor" TEXT,
    "enfileiradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviandoDesde" TIMESTAMP(3),
    "aceitaEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),
    "incertaEm" TIMESTAMP(3),
    "falhouEm" TIMESTAMP(3),
    "canceladaEm" TIMESTAMP(3),
    "enviadaAMaoEm" TIMESTAMP(3),
    "enviadaAMaoPorId" TEXT,
    "resolvidaPorId" TEXT,
    "resolucao" TEXT,
    "criadoPorId" TEXT,

    CONSTRAINT "mensagem_ao_fornecedor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recebimento" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "tipo" "TipoDeRecebimento" NOT NULL DEFAULT 'ENTRADA',
    "numero" INTEGER NOT NULL,
    "chave" TEXT NOT NULL,
    "recebidoPorId" TEXT NOT NULL,
    "recebidaEm" TIMESTAMP(3) NOT NULL,
    "registradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localDestinoId" TEXT,
    "notaEntradaId" TEXT,
    "notaVinculadaExistente" BOOLEAN NOT NULL DEFAULT false,
    "numeroNota" TEXT,
    "serieNota" TEXT,
    "chaveAcesso" TEXT,
    "valorConferido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observacao" TEXT,
    "motivo" TEXT,

    CONSTRAINT "recebimento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "item_de_recebimento" (
    "id" TEXT NOT NULL,
    "recebimentoId" TEXT NOT NULL,
    "itemDePedidoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "embalagensBoas" DECIMAL(14,3) NOT NULL,
    "embalagensAvariada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantidadeBoa" DECIMAL(14,3) NOT NULL,
    "quantidadeAvariada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantidadeRecusada" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "fatorConversao" DECIMAL(14,4) NOT NULL,
    "valorUnitario" DECIMAL(14,6) NOT NULL,
    "valorTotal" DECIMAL(14,2) NOT NULL,
    "decisaoExcedente" "DecisaoDeConferencia",
    "substituicao" BOOLEAN NOT NULL DEFAULT false,
    "decisaoSubstituicao" "DecisaoDeConferencia",
    "lote" TEXT,
    "validade" TIMESTAMP(3),
    "observacao" TEXT,
    "fotoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "item_de_recebimento_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "divergencia_de_compra" (
    "id" TEXT NOT NULL,
    "organizacaoId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "recebimentoId" TEXT,
    "itemDePedidoId" TEXT,
    "notaEntradaId" TEXT,
    "tipo" "TipoDeDivergencia" NOT NULL,
    "detalhe" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3),
    "impacto" DECIMAL(14,2),
    "estado" "EstadoDaDivergencia" NOT NULL DEFAULT 'ABERTA',
    "resolucao" TEXT,
    "resolvidaPorId" TEXT,
    "resolvidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPorId" TEXT,

    CONSTRAINT "divergencia_de_compra_pkey" PRIMARY KEY ("id")
);

-- ------------------------------------- 4. CONVERSÃO: COTAÇÃO → RODADA

-- A cotação era de UMA loja. Vira uma rodada da organização com UMA
-- requisição já enviada — a da loja que cotou. Os números de rodada seguem a
-- ordem em que as cotações foram criadas.
INSERT INTO "rodada_de_compra" (
    "id", "organizacaoId", "descricao", "estado", "versao", "prazoCotacao",
    "observacao", "criadoEm", "atualizadoEm", "criadoPorId", "consolidadaEm",
    "cotacaoEncerradaEm", "fechadaEm", "canceladaEm"
)
SELECT c."id", u."organizacaoId", c."descricao",
       (CASE c."status"::text
          WHEN 'ABERTA' THEN 'COTANDO'
          WHEN 'FECHADA' THEN 'FECHADA'
          ELSE 'CANCELADA'
        END)::"EstadoRodada",
       1, c."validaAte", c."observacao", c."criadoEm", c."atualizadoEm",
       c."criadoPorId", c."criadoEm", c."fechadaEm", c."fechadaEm", c."canceladaEm"
FROM "cotacao" c
JOIN "unidade" u ON u."id" = c."unidadeId"
ORDER BY c."criadoEm", c."id";

INSERT INTO "requisicao" (
    "id", "organizacaoId", "rodadaId", "unidadeId", "status", "observacao",
    "enviadaEm", "enviadaPorId", "criadoEm", "atualizadoEm", "criadoPorId"
)
SELECT 'req_' || c."id", u."organizacaoId", c."id", c."unidadeId", 'ENVIADA',
       'Convertida da cotação de 04/08.', c."criadoEm", c."criadoPorId",
       c."criadoEm", c."atualizadoEm", c."criadoPorId"
FROM "cotacao" c
JOIN "unidade" u ON u."id" = c."unidadeId";

INSERT INTO "item_da_rodada" (
    "id", "rodadaId", "insumoId", "quantidadeTotal", "modo", "observacao", "ordem"
)
SELECT i."id", i."cotacaoId", i."insumoId", i."quantidade", 'COTAVEL',
       i."observacao", i."ordem"
FROM "item_de_cotacao" i;

INSERT INTO "item_de_requisicao" (
    "id", "requisicaoId", "unidadeId", "insumoId", "quantidade", "categoria",
    "observacao", "criadoEm", "atualizadoEm", "criadoPorId"
)
SELECT 'ireq_' || i."id", 'req_' || i."cotacaoId", c."unidadeId", i."insumoId",
       i."quantidade", ins."categoria", i."observacao", c."criadoEm",
       c."atualizadoEm", c."criadoPorId"
FROM "item_de_cotacao" i
JOIN "cotacao" c ON c."id" = i."cotacaoId"
JOIN "insumo" ins ON ins."id" = i."insumoId";

-- A proposta vira a SOLICITAÇÃO. Quem ainda aguardava numa cotação já fechada
-- vira "encerrada sem resposta" — a verdade sobre o que aconteceu.
INSERT INTO "solicitacao_de_cotacao" (
    "id", "organizacaoId", "rodadaId", "fornecedorId", "status", "prazo",
    "convidadoEm", "versaoAtual", "criadoEm", "atualizadoEm"
)
SELECT p."id", u."organizacaoId", p."cotacaoId", p."fornecedorId",
       (CASE
          WHEN p."status"::text = 'RECUSADA' THEN 'RECUSOU'
          WHEN p."status"::text = 'RESPONDIDA' AND c."status"::text = 'ABERTA' THEN 'RESPONDIDA'
          WHEN p."status"::text = 'RESPONDIDA' THEN 'ENCERRADA'
          WHEN c."status"::text = 'ABERTA' THEN 'CONVIDADO'
          ELSE 'ENCERRADA_SEM_RESPOSTA'
        END)::"StatusSolicitacao",
       c."validaAte", p."criadoEm",
       CASE WHEN EXISTS (SELECT 1 FROM "preco_proposto" x WHERE x."propostaId" = p."id")
            THEN 1 ELSE 0 END,
       p."criadoEm", p."atualizadoEm"
FROM "proposta_de_cotacao" p
JOIN "cotacao" c ON c."id" = p."cotacaoId"
JOIN "unidade" u ON u."id" = c."unidadeId";

-- Na cotação antiga todo fornecedor via a lista inteira.
INSERT INTO "item_da_solicitacao" ("id", "solicitacaoId", "itemDaRodadaId")
SELECT 'isol_' || p."id" || '_' || i."id", p."id", i."id"
FROM "proposta_de_cotacao" p
JOIN "item_de_cotacao" i ON i."cotacaoId" = p."cotacaoId";

-- A resposta que existia vira a versão 1, digitada pelo comprador — que é
-- como ela foi lançada em 04/08.
INSERT INTO "versao_de_proposta" (
    "id", "solicitacaoId", "numero", "origem", "frete", "pedidoMinimo",
    "observacao", "recebidaEm"
)
SELECT 'ver_' || p."id", p."id", 1, 'COMPRADOR_DIGITOU', p."frete",
       p."pedidoMinimo", p."observacao", COALESCE(p."respondidaEm", p."atualizadoEm")
FROM "proposta_de_cotacao" p
WHERE EXISTS (SELECT 1 FROM "preco_proposto" x WHERE x."propostaId" = p."id");

-- O fator digitado em 04/08 vira o CONTEÚDO de uma embalagem de uma peça, na
-- unidade do próprio insumo: "Caixa 10kg" com fator 10 continua valendo 10.
INSERT INTO "item_de_proposta" (
    "id", "versaoId", "itemDaSolicitacaoId", "situacao", "nomeEmbalagem",
    "pecas", "conteudo", "unidadeConteudo", "fator", "precoEmbalagem",
    "precoUnitario", "observacao"
)
SELECT pp."id", 'ver_' || pp."propostaId",
       'isol_' || pp."propostaId" || '_' || pp."itemId",
       (CASE WHEN pp."naoAtende" THEN 'INDISPONIVEL' ELSE 'COTADO' END)::"SituacaoDaOferta",
       pp."embalagem", 1,
       CASE WHEN pp."naoAtende" THEN NULL ELSE pp."fatorConversao" END,
       CASE WHEN pp."naoAtende" THEN NULL ELSE ins."unidadeMedida" END,
       CASE WHEN pp."naoAtende" THEN NULL ELSE pp."fatorConversao" END,
       CASE WHEN pp."naoAtende" THEN NULL ELSE ROUND(pp."precoEmbalagem", 2) END,
       CASE WHEN pp."naoAtende" THEN NULL ELSE pp."precoUnitario" END,
       pp."observacao"
FROM "preco_proposto" pp
JOIN "item_de_cotacao" i ON i."id" = pp."itemId"
JOIN "insumo" ins ON ins."id" = i."insumoId";

-- ------------------------------------------------------------ 5. PEDIDO

-- Os estados antigos, traduzidos: ENVIADO passou por alguém e saiu — é um
-- pedido aprovado; RECEBIDO chegou — está concluído.
ALTER TABLE "pedido" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "StatusPedido_new" AS ENUM ('RASCUNHO', 'AGUARDANDO_APROVACAO', 'APROVADO', 'RECUSADO', 'CANCELADO', 'CONCLUIDO');
ALTER TABLE "pedido" ALTER COLUMN "status" TYPE "StatusPedido_new"
  USING (CASE "status"::text
           WHEN 'ENVIADO' THEN 'APROVADO'
           WHEN 'RECEBIDO' THEN 'CONCLUIDO'
           ELSE "status"::text
         END)::"StatusPedido_new";
ALTER TYPE "StatusPedido" RENAME TO "StatusPedido_old";
ALTER TYPE "StatusPedido_new" RENAME TO "StatusPedido";
DROP TYPE "StatusPedido_old";
ALTER TABLE "pedido" ALTER COLUMN "status" SET DEFAULT 'RASCUNHO';

ALTER TABLE "pedido" DROP CONSTRAINT "pedido_cotacaoId_fkey";

ALTER TABLE "pedido" ADD COLUMN "aprovadoEm" TIMESTAMP(3),
ADD COLUMN "aprovadoPorId" TEXT,
ADD COLUMN "concluidoEm" TIMESTAMP(3),
ADD COLUMN "condicaoPagamento" TEXT,
ADD COLUMN "confirmacao" "ConfirmacaoFornecedor" NOT NULL DEFAULT 'PENDENTE',
ADD COLUMN "confirmacaoRegistradaPorId" TEXT,
ADD COLUMN "confirmacaoTexto" TEXT,
ADD COLUMN "confirmadoEm" TIMESTAMP(3),
ADD COLUMN "destinoTelefone" TEXT,
ADD COLUMN "enderecoEntrega" TEXT,
ADD COLUMN "entregaAte" TIMESTAMP(3),
ADD COLUMN "entregaDe" TIMESTAMP(3),
ADD COLUMN "enviadoManualmenteEm" TIMESTAMP(3),
ADD COLUMN "enviadoManualmentePorId" TEXT,
ADD COLUMN "fornecedorDocumento" TEXT,
ADD COLUMN "fornecedorNome" TEXT,
ADD COLUMN "motivoCancelamento" TEXT,
ADD COLUMN "motivoRecusa" TEXT,
ADD COLUMN "numero" SERIAL NOT NULL,
ADD COLUMN "organizacaoId" TEXT,
ADD COLUMN "pedidoOrigemId" TEXT,
ADD COLUMN "recusadoEm" TIMESTAMP(3),
ADD COLUMN "regraArredondamento" TEXT NOT NULL DEFAULT 'linha-meio-para-cima-v1',
ADD COLUMN "rodadaId" TEXT,
ADD COLUMN "sequencia" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "situacaoRecebimento" "SituacaoRecebimento" NOT NULL DEFAULT 'NADA',
ADD COLUMN "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "tipo" "TipoDePedido" NOT NULL DEFAULT 'PEDIDO',
ADD COLUMN "ultimaSequencia" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "unidadeNome" TEXT,
ADD COLUMN "versao" INTEGER NOT NULL DEFAULT 1;

-- O snapshot dos pedidos antigos é tirado AGORA, do cadastro de hoje: é o
-- melhor retrato disponível de quem era o fornecedor e onde era a loja.
UPDATE "pedido" p SET
    "organizacaoId" = u."organizacaoId",
    "unidadeNome" = u."nome",
    "enderecoEntrega" = NULLIF(concat_ws(', ', u."endereco", u."bairro", u."cidade"), ''),
    "fornecedorNome" = f."nome",
    "fornecedorDocumento" = f."documento",
    "condicaoPagamento" = f."condicaoPagamento",
    "rodadaId" = p."cotacaoId",
    "aprovadoEm" = CASE WHEN p."status" IN ('APROVADO', 'CONCLUIDO')
                        THEN COALESCE(p."enviadoEm", p."criadoEm") END,
    "aprovadoPorId" = CASE WHEN p."status" IN ('APROVADO', 'CONCLUIDO')
                           THEN p."criadoPorId" END,
    "enviadoManualmenteEm" = p."enviadoEm",
    "concluidoEm" = p."recebidoEm",
    "situacaoRecebimento" = (CASE WHEN p."status" = 'CONCLUIDO' THEN 'COMPLETO' ELSE 'NADA' END)::"SituacaoRecebimento",
    "subtotal" = p."total" - p."frete"
FROM "unidade" u, "fornecedor" f
WHERE u."id" = p."unidadeId" AND f."id" = p."fornecedorId";

ALTER TABLE "pedido" ALTER COLUMN "organizacaoId" SET NOT NULL,
ALTER COLUMN "unidadeNome" SET NOT NULL,
ALTER COLUMN "fornecedorNome" SET NOT NULL;

ALTER TABLE "pedido" DROP COLUMN "cotacaoId",
DROP COLUMN "enviadoEm",
DROP COLUMN "recebidoEm";

ALTER TABLE "item_de_pedido" ADD COLUMN "adicional" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN "conteudo" DECIMAL(14,4),
ADD COLUMN "embalagens" DECIMAL(14,3),
ADD COLUMN "fracionavel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "insumoNome" TEXT,
ADD COLUMN "itemDePropostaId" TEXT,
ADD COLUMN "itemDeRequisicaoId" TEXT,
ADD COLUMN "nomeEmbalagem" TEXT,
ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "origemPreco" TEXT,
ADD COLUMN "pecas" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "precoEmbalagem" DECIMAL(14,2),
ADD COLUMN "quantidadeCancelada" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN "quantidadeNecessaria" DECIMAL(14,3),
ADD COLUMN "unidadeConteudo" "UnidadeMedida",
ADD COLUMN "unidadeEstoque" "UnidadeMedida",
ALTER COLUMN "precoUnitario" SET DATA TYPE DECIMAL(14,6);

UPDATE "item_de_pedido" ip SET
    "insumoNome" = ins."nome",
    "unidadeEstoque" = ins."unidadeMedida",
    "nomeEmbalagem" = ip."embalagem",
    "conteudo" = ip."fatorConversao",
    "unidadeConteudo" = ins."unidadeMedida",
    "embalagens" = ROUND(ip."quantidade" / NULLIF(ip."fatorConversao", 0), 3),
    "quantidadeNecessaria" = ip."quantidade",
    "precoEmbalagem" = ROUND(ip."precoUnitario" * ip."fatorConversao", 2),
    "origemPreco" = 'Convertido do pedido de 04/08'
FROM "insumo" ins
WHERE ins."id" = ip."insumoId";

ALTER TABLE "item_de_pedido" ALTER COLUMN "embalagens" SET NOT NULL,
ALTER COLUMN "insumoNome" SET NOT NULL,
ALTER COLUMN "origemPreco" SET NOT NULL,
ALTER COLUMN "precoEmbalagem" SET NOT NULL,
ALTER COLUMN "quantidadeNecessaria" SET NOT NULL,
ALTER COLUMN "unidadeEstoque" SET NOT NULL;

ALTER TABLE "item_de_pedido" DROP COLUMN "embalagem";

-- ----------------------------------------------- 6. SAEM AS TABELAS ANTIGAS

ALTER TABLE "item_de_cotacao" DROP CONSTRAINT "item_de_cotacao_cotacaoId_fkey";
ALTER TABLE "item_de_cotacao" DROP CONSTRAINT "item_de_cotacao_insumoId_fkey";
ALTER TABLE "preco_proposto" DROP CONSTRAINT "preco_proposto_itemId_fkey";
ALTER TABLE "preco_proposto" DROP CONSTRAINT "preco_proposto_propostaId_fkey";
ALTER TABLE "proposta_de_cotacao" DROP CONSTRAINT "proposta_de_cotacao_cotacaoId_fkey";
ALTER TABLE "proposta_de_cotacao" DROP CONSTRAINT "proposta_de_cotacao_fornecedorId_fkey";

DROP TABLE "preco_proposto";
DROP TABLE "proposta_de_cotacao";
DROP TABLE "item_de_cotacao";
DROP TABLE "cotacao";

DROP TYPE "StatusCotacao";
DROP TYPE "StatusProposta";

-- ------------------------------------------------------- 7. ÍNDICES

CREATE UNIQUE INDEX "fornecedor_insumo_chaveFixo_key" ON "fornecedor_insumo"("chaveFixo");
CREATE INDEX "fornecedor_insumo_organizacaoId_insumoId_idx" ON "fornecedor_insumo"("organizacaoId", "insumoId");
CREATE UNIQUE INDEX "fornecedor_insumo_fornecedorId_insumoId_nomeEmbalagem_key" ON "fornecedor_insumo"("fornecedorId", "insumoId", "nomeEmbalagem");
CREATE UNIQUE INDEX "agenda_de_rodada_organizacaoId_nome_key" ON "agenda_de_rodada"("organizacaoId", "nome");
CREATE UNIQUE INDEX "rodada_de_compra_numero_key" ON "rodada_de_compra"("numero");
CREATE INDEX "rodada_de_compra_organizacaoId_estado_idx" ON "rodada_de_compra"("organizacaoId", "estado");
CREATE INDEX "rodada_de_compra_organizacaoId_criadoEm_idx" ON "rodada_de_compra"("organizacaoId", "criadoEm");
CREATE UNIQUE INDEX "rodada_de_compra_agendaId_ocorrencia_key" ON "rodada_de_compra"("agendaId", "ocorrencia");
CREATE INDEX "requisicao_unidadeId_status_idx" ON "requisicao"("unidadeId", "status");
CREATE UNIQUE INDEX "requisicao_rodadaId_unidadeId_key" ON "requisicao"("rodadaId", "unidadeId");
CREATE INDEX "item_de_requisicao_insumoId_idx" ON "item_de_requisicao"("insumoId");
CREATE UNIQUE INDEX "item_de_requisicao_requisicaoId_insumoId_key" ON "item_de_requisicao"("requisicaoId", "insumoId");
CREATE INDEX "item_da_rodada_rodadaId_ordem_idx" ON "item_da_rodada"("rodadaId", "ordem");
CREATE UNIQUE INDEX "item_da_rodada_rodadaId_insumoId_key" ON "item_da_rodada"("rodadaId", "insumoId");
CREATE UNIQUE INDEX "solicitacao_de_cotacao_tokenHash_key" ON "solicitacao_de_cotacao"("tokenHash");
CREATE INDEX "solicitacao_de_cotacao_fornecedorId_idx" ON "solicitacao_de_cotacao"("fornecedorId");
CREATE UNIQUE INDEX "solicitacao_de_cotacao_rodadaId_fornecedorId_key" ON "solicitacao_de_cotacao"("rodadaId", "fornecedorId");
CREATE INDEX "item_da_solicitacao_itemDaRodadaId_idx" ON "item_da_solicitacao"("itemDaRodadaId");
CREATE UNIQUE INDEX "item_da_solicitacao_solicitacaoId_itemDaRodadaId_key" ON "item_da_solicitacao"("solicitacaoId", "itemDaRodadaId");
CREATE UNIQUE INDEX "versao_de_proposta_solicitacaoId_numero_key" ON "versao_de_proposta"("solicitacaoId", "numero");
CREATE INDEX "item_de_proposta_itemDaSolicitacaoId_idx" ON "item_de_proposta"("itemDaSolicitacaoId");
CREATE UNIQUE INDEX "item_de_proposta_versaoId_itemDaSolicitacaoId_key" ON "item_de_proposta"("versaoId", "itemDaSolicitacaoId");
CREATE UNIQUE INDEX "escolha_de_item_itemDaRodadaId_key" ON "escolha_de_item"("itemDaRodadaId");
CREATE INDEX "escolha_de_item_rodadaId_idx" ON "escolha_de_item"("rodadaId");
CREATE UNIQUE INDEX "alcada_de_compra_chaveVigente_key" ON "alcada_de_compra"("chaveVigente");
CREATE INDEX "alcada_de_compra_organizacaoId_papelId_idx" ON "alcada_de_compra"("organizacaoId", "papelId");
CREATE INDEX "aprovacao_de_compra_pedidoId_idx" ON "aprovacao_de_compra"("pedidoId");
CREATE UNIQUE INDEX "alteracao_de_pedido_pedidoId_sequencia_key" ON "alteracao_de_pedido"("pedidoId", "sequencia");
CREATE INDEX "item_de_alteracao_alteracaoId_idx" ON "item_de_alteracao"("alteracaoId");
CREATE UNIQUE INDEX "canal_de_compras_organizacaoId_key" ON "canal_de_compras"("organizacaoId");
CREATE UNIQUE INDEX "mensagem_ao_fornecedor_chave_key" ON "mensagem_ao_fornecedor"("chave");
CREATE INDEX "mensagem_ao_fornecedor_estado_proximaTentativaEm_idx" ON "mensagem_ao_fornecedor"("estado", "proximaTentativaEm");
CREATE INDEX "mensagem_ao_fornecedor_referenciaTipo_referenciaId_idx" ON "mensagem_ao_fornecedor"("referenciaTipo", "referenciaId");
CREATE INDEX "mensagem_ao_fornecedor_organizacaoId_estado_idx" ON "mensagem_ao_fornecedor"("organizacaoId", "estado");
CREATE UNIQUE INDEX "recebimento_chave_key" ON "recebimento"("chave");
CREATE INDEX "recebimento_unidadeId_recebidaEm_idx" ON "recebimento"("unidadeId", "recebidaEm");
CREATE UNIQUE INDEX "recebimento_pedidoId_tipo_numero_key" ON "recebimento"("pedidoId", "tipo", "numero");
CREATE INDEX "item_de_recebimento_recebimentoId_idx" ON "item_de_recebimento"("recebimentoId");
CREATE INDEX "item_de_recebimento_itemDePedidoId_idx" ON "item_de_recebimento"("itemDePedidoId");
CREATE INDEX "divergencia_de_compra_unidadeId_estado_idx" ON "divergencia_de_compra"("unidadeId", "estado");
CREATE INDEX "divergencia_de_compra_pedidoId_idx" ON "divergencia_de_compra"("pedidoId");
CREATE INDEX "arquivo_entidade_entidadeId_idx" ON "arquivo"("entidade", "entidadeId");
CREATE INDEX "arquivo_organizacaoId_criadoEm_idx" ON "arquivo"("organizacaoId", "criadoEm");
CREATE UNIQUE INDEX "nota_entrada_recebimentoId_key" ON "nota_entrada"("recebimentoId");
CREATE INDEX "nota_entrada_pedidoId_idx" ON "nota_entrada"("pedidoId");
CREATE UNIQUE INDEX "pedido_numero_key" ON "pedido"("numero");
CREATE INDEX "pedido_organizacaoId_status_idx" ON "pedido"("organizacaoId", "status");
CREATE INDEX "pedido_rodadaId_idx" ON "pedido"("rodadaId");
CREATE UNIQUE INDEX "pedido_pedidoOrigemId_sequencia_key" ON "pedido"("pedidoOrigemId", "sequencia");

-- ------------------------------------------------- 8. CHAVES ESTRANGEIRAS

ALTER TABLE "fornecedor_insumo" ADD CONSTRAINT "fornecedor_insumo_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fornecedor_insumo" ADD CONSTRAINT "fornecedor_insumo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rodada_de_compra" ADD CONSTRAINT "rodada_de_compra_agendaId_fkey" FOREIGN KEY ("agendaId") REFERENCES "agenda_de_rodada"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "requisicao" ADD CONSTRAINT "requisicao_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "rodada_de_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_de_requisicao" ADD CONSTRAINT "item_de_requisicao_requisicaoId_fkey" FOREIGN KEY ("requisicaoId") REFERENCES "requisicao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_de_requisicao" ADD CONSTRAINT "item_de_requisicao_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_da_rodada" ADD CONSTRAINT "item_da_rodada_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "rodada_de_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_da_rodada" ADD CONSTRAINT "item_da_rodada_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_da_rodada" ADD CONSTRAINT "item_da_rodada_fornecedorFixoId_fkey" FOREIGN KEY ("fornecedorFixoId") REFERENCES "fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "solicitacao_de_cotacao" ADD CONSTRAINT "solicitacao_de_cotacao_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "rodada_de_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "solicitacao_de_cotacao" ADD CONSTRAINT "solicitacao_de_cotacao_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_da_solicitacao" ADD CONSTRAINT "item_da_solicitacao_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacao_de_cotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_da_solicitacao" ADD CONSTRAINT "item_da_solicitacao_itemDaRodadaId_fkey" FOREIGN KEY ("itemDaRodadaId") REFERENCES "item_da_rodada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "versao_de_proposta" ADD CONSTRAINT "versao_de_proposta_solicitacaoId_fkey" FOREIGN KEY ("solicitacaoId") REFERENCES "solicitacao_de_cotacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_de_proposta" ADD CONSTRAINT "item_de_proposta_versaoId_fkey" FOREIGN KEY ("versaoId") REFERENCES "versao_de_proposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_de_proposta" ADD CONSTRAINT "item_de_proposta_itemDaSolicitacaoId_fkey" FOREIGN KEY ("itemDaSolicitacaoId") REFERENCES "item_da_solicitacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escolha_de_item" ADD CONSTRAINT "escolha_de_item_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "rodada_de_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escolha_de_item" ADD CONSTRAINT "escolha_de_item_itemDaRodadaId_fkey" FOREIGN KEY ("itemDaRodadaId") REFERENCES "item_da_rodada"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "escolha_de_item" ADD CONSTRAINT "escolha_de_item_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "escolha_de_item" ADD CONSTRAINT "escolha_de_item_itemDePropostaId_fkey" FOREIGN KEY ("itemDePropostaId") REFERENCES "item_de_proposta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "aprovacao_de_compra" ADD CONSTRAINT "aprovacao_de_compra_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "aprovacao_de_compra" ADD CONSTRAINT "aprovacao_de_compra_alcadaId_fkey" FOREIGN KEY ("alcadaId") REFERENCES "alcada_de_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "rodada_de_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_pedidoOrigemId_fkey" FOREIGN KEY ("pedidoOrigemId") REFERENCES "pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "alteracao_de_pedido" ADD CONSTRAINT "alteracao_de_pedido_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_de_alteracao" ADD CONSTRAINT "item_de_alteracao_alteracaoId_fkey" FOREIGN KEY ("alteracaoId") REFERENCES "alteracao_de_pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "item_de_alteracao" ADD CONSTRAINT "item_de_alteracao_itemDePedidoId_fkey" FOREIGN KEY ("itemDePedidoId") REFERENCES "item_de_pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mensagem_ao_fornecedor" ADD CONSTRAINT "mensagem_ao_fornecedor_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recebimento" ADD CONSTRAINT "recebimento_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_de_recebimento" ADD CONSTRAINT "item_de_recebimento_recebimentoId_fkey" FOREIGN KEY ("recebimentoId") REFERENCES "recebimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_de_recebimento" ADD CONSTRAINT "item_de_recebimento_itemDePedidoId_fkey" FOREIGN KEY ("itemDePedidoId") REFERENCES "item_de_pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_de_recebimento" ADD CONSTRAINT "item_de_recebimento_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "divergencia_de_compra" ADD CONSTRAINT "divergencia_de_compra_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedido"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "divergencia_de_compra" ADD CONSTRAINT "divergencia_de_compra_recebimentoId_fkey" FOREIGN KEY ("recebimentoId") REFERENCES "recebimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;

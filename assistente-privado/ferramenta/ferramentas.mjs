import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { lerCsv } from "./csv.mjs";
import { dataBr, diasEntre, hojeEmSaoPaulo, lerData } from "./datas.mjs";
import { reais } from "./dinheiro.mjs";
import {
  EmAndamento,
  chaveDaExecucao,
  comTrava,
  estadoAtual,
  gravarDados,
  gravarRelatorio,
  lerExecucao,
  marcarEstado,
} from "./execucao.mjs";
import { calcularFechamento, mesmaLoja } from "./fechamento.mjs";
import { enviarRegistro } from "./registro.mjs";
import { limparTexto } from "./sanitizar.mjs";

/**
 * AS FERRAMENTAS QUE O AGENTE ENXERGA — e o que elas negam.
 *
 * Quem decide a pasta e a loja é a CONFIGURAÇÃO (variável de ambiente), nunca
 * o modelo. Pedido de outra loja, caminho com barra, arquivo que não é .csv,
 * link simbólico: acesso negado, e o Tetteo fica sabendo.
 *
 * Não existe ferramenta que crie pedido, pague, mande mensagem ou escreva em
 * outro sistema. O que o agente pode fazer além de ler é PREPARAR: relatório
 * e rascunho, dentro do workspace, com cabeçalho dizendo o que são.
 */

export const LIMITE_DO_ARQUIVO = 5 * 1024 * 1024;
export const MAXIMO_DE_DIAS = 366;
const RE_NOME = /^[\w.-]{1,80}\.csv$/i;
const RE_CHAVE = /^[a-f0-9]{16}$/;

const quandoBr = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function lerConfiguracao(env = process.env) {
  const valor = (nome) => {
    const v = env[nome];
    return v && !v.startsWith("${") ? v : "";
  };
  const pastaDados = valor("PASTA_DADOS");
  const pastaTrabalho = valor("PASTA_TRABALHO");
  const lojaPermitida = valor("LOJA_PERMITIDA");
  if (!pastaDados || !pastaTrabalho || !lojaPermitida) {
    throw new Error(
      "Configuração incompleta: PASTA_DADOS, PASTA_TRABALHO e LOJA_PERMITIDA são obrigatórias.",
    );
  }
  return {
    pastaDados: path.resolve(pastaDados),
    pastaTrabalho: path.resolve(pastaTrabalho),
    lojaPermitida,
    diasParaDesatualizado: Number(valor("DIAS_PARA_DESATUALIZADO") || 2),
    demonstracao: valor("DEMONSTRACAO") === "1",
    registro: {
      url: valor("TETTEO_REGISTRO_URL"),
      segredo: valor("TETTEO_REGISTRO_SEGREDO"),
    },
  };
}

const semParametros = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const DEFINICOES = [
  {
    name: "listar_arquivos",
    description:
      "Lista os arquivos CSV de vendas da pasta autorizada (nome, tamanho, data de alteração). Não lê nada fora dela.",
    inputSchema: semParametros,
  },
  {
    name: "calcular_fechamento",
    description:
      "Calcula o fechamento de vendas de um CSV da pasta autorizada: total, pedidos, ticket médio, anomalias e última data, só da loja configurada. Devolve uma chave. Estes números são a única fonte dos números do relatório.",
    inputSchema: {
      type: "object",
      properties: {
        arquivo: {
          type: "string",
          description: "Nome do arquivo, como listado. Ex.: vendas-30-dias.csv",
        },
        de: {
          type: "string",
          description: "Início do período, AAAA-MM-DD ou DD/MM/AAAA. Opcional.",
        },
        ate: {
          type: "string",
          description: "Fim do período, AAAA-MM-DD ou DD/MM/AAAA. Opcional.",
        },
        loja: {
          type: "string",
          description: "Opcional. Só a loja configurada é aceita.",
        },
      },
      required: ["arquivo"],
      additionalProperties: false,
    },
  },
  {
    name: "salvar_relatorio",
    description:
      "Salva o relatório de uma chave calculada. O cabeçalho com período, fonte e números vem da chave; o texto enviado traz as três observações ([dado] ou [hipótese]) e as ações propostas.",
    inputSchema: {
      type: "object",
      properties: { chave: { type: "string" }, texto: { type: "string" } },
      required: ["chave", "texto"],
      additionalProperties: false,
    },
  },
  {
    name: "salvar_rascunho",
    description:
      "Prepara um rascunho (por exemplo, uma proposta de compra) em rascunhos/. Nada é executado: o rascunho espera a decisão do responsável.",
    inputSchema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        conteudo: { type: "string" },
        chave: {
          type: "string",
          description:
            "Opcional: a chave do fechamento que motivou o rascunho.",
        },
      },
      required: ["titulo", "conteudo"],
      additionalProperties: false,
    },
  },
  {
    name: "cancelar_execucao",
    description:
      "Cancela, a pedido do responsável, uma execução calculada que ainda não virou relatório.",
    inputSchema: {
      type: "object",
      properties: { chave: { type: "string" } },
      required: ["chave"],
      additionalProperties: false,
    },
  },
];

function resumo(...partes) {
  return createHash("sha256")
    .update(partes.join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function indicadoresDe(d) {
  return {
    totalCentavos: d.totalCentavos,
    pedidos: d.pedidos,
    ticketCentavos: d.ticketCentavos,
    diasComVenda: d.diasComVenda,
    diasNoPeriodo: d.diasNoPeriodo,
    ultimaData: d.ultimaData,
    desatualizado: d.desatualizado,
  };
}

function slug(texto) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function criarFerramentas(
  config,
  { agora = () => new Date(), enviar = enviarRegistro } = {},
) {
  const relatorios = path.join(config.pastaTrabalho, "relatorios");
  const rascunhos = path.join(config.pastaTrabalho, "rascunhos");

  function registrar(corpo) {
    return enviar({
      url: config.registro.url,
      segredo: config.registro.segredo,
      corpo: {
        demonstracao: config.demonstracao,
        ocorridoEm: agora().toISOString(),
        avisos: [],
        pendencias: [],
        ...corpo,
      },
    });
  }

  function pendenciasDe(d) {
    return d.desatualizado ? [`Arquivo desatualizado: ${d.arquivo}`] : [];
  }

  async function anotarTentativa(arquivo, linhas) {
    const quando = agora().toISOString();
    await mkdir(relatorios, { recursive: true });
    await appendFile(
      path.join(relatorios, "seguranca.log"),
      linhas
        .map(
          (l) =>
            `${quando} arquivo=${arquivo} linha=${l} coluna=observacao: conteúdo com forma de instrução, omitido\n`,
        )
        .join(""),
      "utf8",
    );
  }

  async function resolverArquivo(nome) {
    if (typeof nome !== "string" || !RE_NOME.test(nome)) {
      return {
        negado: "Só arquivos .csv da pasta autorizada, pelo nome, sem caminho.",
      };
    }
    const alvo = path.join(config.pastaDados, nome);
    let info;
    try {
      info = await lstat(alvo);
    } catch {
      return { ausente: true };
    }
    if (!info.isFile())
      return { negado: "Isso não é um arquivo comum da pasta autorizada." };
    const [real, raiz] = await Promise.all([
      realpath(alvo),
      realpath(config.pastaDados),
    ]);
    if (path.dirname(real) !== raiz)
      return { negado: "O arquivo está fora da pasta autorizada." };
    if (info.size > LIMITE_DO_ARQUIVO)
      return { invalido: "o arquivo passa de 5 MB" };
    return { caminho: real };
  }

  function montarRelatorio(d, texto) {
    const periodo = d.periodo
      ? `${dataBr(d.periodo.de)} a ${dataBr(d.periodo.ate)}`
      : "sem período";
    const ticket =
      d.ticketCentavos === null
        ? "sem pedidos no período"
        : reais(d.ticketCentavos);
    const linhas = [
      `FECHAMENTO — ${periodo} · ${d.loja}${config.demonstracao ? " (demonstração)" : ""}`,
      `Fonte: dados-exemplo/${d.arquivo} · ${d.linhasLidas} linhas lidas, ${d.linhasDescartadas} descartadas, ${d.linhasDeOutraLoja} de outra loja ignoradas`,
      `Última informação: ${d.ultimaData ? dataBr(d.ultimaData) : "nenhuma"}${d.desatualizado ? " — DESATUALIZADO" : ""}`,
      "",
      `Total: ${reais(d.totalCentavos)} · Pedidos: ${d.pedidos} · Ticket médio: ${ticket} · Dias com venda: ${d.diasComVenda} de ${d.diasNoPeriodo}`,
      "",
      "Anomalias (dado, calculado pela ferramenta)",
      ...(d.anomalias.length
        ? d.anomalias.map((a) => `- ${a.texto}`)
        : ["- nenhuma"]),
      "",
      "Avisos",
      ...(d.avisos.length ? d.avisos.map((a) => `- ${a}`) : ["- nenhum"]),
      "",
      "Texto do assistente",
      texto,
      "",
      `Chave: ${d.chave} · calculado em ${quandoBr.format(new Date(d.calculadoEm))} · salvo em ${quandoBr.format(agora())}`,
      "",
    ];
    return linhas.join("\n");
  }

  const tratadores = {
    async listar_arquivos() {
      const nomes = await readdir(config.pastaDados).catch(() => []);
      const arquivos = [];
      for (const nome of nomes.sort()) {
        if (!RE_NOME.test(nome)) continue;
        const info = await lstat(path.join(config.pastaDados, nome));
        if (!info.isFile()) continue;
        arquivos.push({
          nome,
          tamanhoBytes: info.size,
          alteradoEm: info.mtime.toISOString(),
        });
      }
      return { pasta: "dados-exemplo", arquivos };
    },

    async calcular_fechamento({ arquivo, de, ate, loja } = {}) {
      const fonte =
        typeof arquivo === "string" && RE_NOME.test(arquivo) ? arquivo : null;

      if (loja !== undefined && !mesmaLoja(loja, config.lojaPermitida)) {
        await registrar({
          tipo: "execucao",
          chave: `negado:${resumo(String(arquivo), String(loja))}`,
          estado: "acesso_negado",
          fonte,
          detalhe: "Pedido de outra loja.",
        });
        return {
          estado: "acesso_negado",
          motivo: `Esta ferramenta só fecha a ${config.lojaPermitida}. Outras lojas não são lidas.`,
        };
      }

      const alvo = await resolverArquivo(arquivo);
      if (alvo.negado) {
        await registrar({
          tipo: "execucao",
          chave: `negado:${resumo(String(arquivo))}`,
          estado: "acesso_negado",
          fonte,
          detalhe: alvo.negado,
        });
        return { estado: "acesso_negado", motivo: alvo.negado };
      }
      if (alvo.ausente || alvo.invalido) {
        const motivo = alvo.ausente
          ? "não existe na pasta autorizada — use listar_arquivos"
          : alvo.invalido;
        await registrar({
          tipo: "execucao",
          chave: `invalido:${resumo(String(arquivo), motivo)}`,
          estado: "arquivo_invalido",
          fonte,
          detalhe: motivo,
        });
        return { estado: "arquivo_invalido", arquivo, motivo, linha: null };
      }

      const inicio = de === undefined ? null : lerData(de);
      const fim = ate === undefined ? null : lerData(ate);
      if ((de !== undefined && !inicio) || (ate !== undefined && !fim)) {
        return {
          estado: "erro_de_parametro",
          motivo: "Use datas AAAA-MM-DD ou DD/MM/AAAA.",
        };
      }
      if (
        inicio &&
        fim &&
        (fim < inicio || diasEntre(inicio, fim) + 1 > MAXIMO_DE_DIAS)
      ) {
        return {
          estado: "erro_de_parametro",
          motivo:
            "Período inválido: o fim vem antes do início, ou passa de 366 dias.",
        };
      }

      const conteudo = await readFile(alvo.caminho);
      const leitura = lerCsv(conteudo.toString("utf8"));
      if (!leitura.ok) {
        await registrar({
          tipo: "execucao",
          chave: `invalido:${resumo(arquivo, createHash("sha256").update(conteudo).digest("hex"))}`,
          estado: "arquivo_invalido",
          fonte: arquivo,
          detalhe: leitura.linha
            ? `Linha ${leitura.linha}: ${leitura.motivo}`
            : leitura.motivo,
        });
        return {
          estado: "arquivo_invalido",
          arquivo,
          motivo: leitura.motivo,
          linha: leitura.linha,
        };
      }

      const calculo = calcularFechamento({
        ...leitura,
        loja: config.lojaPermitida,
        de: inicio,
        ate: fim,
        hoje: hojeEmSaoPaulo(agora()),
        diasParaDesatualizado: config.diasParaDesatualizado,
      });
      const chave = chaveDaExecucao({
        conteudo,
        loja: config.lojaPermitida,
        de: calculo.periodo?.de ?? "",
        ate: calculo.periodo?.ate ?? "",
      });

      try {
        return await comTrava(config.pastaTrabalho, chave, async () => {
          const existente = await lerExecucao(config.pastaTrabalho, chave);
          if (existente.dados) {
            return {
              ...existente.dados,
              estado: estadoAtual(existente, agora()),
              reaproveitado: true,
            };
          }
          const dados = {
            ...calculo,
            arquivo,
            chave,
            calculadoEm: agora().toISOString(),
          };
          await gravarDados(config.pastaTrabalho, chave, dados);
          const suspeitas = calculo.observacoes
            .filter((o) => o.suspeita)
            .map((o) => o.linha);
          if (suspeitas.length) await anotarTentativa(arquivo, suspeitas);
          await registrar({
            tipo: "execucao",
            chave,
            estado: calculo.estado,
            fonte: arquivo,
            periodo: calculo.periodo,
            indicadores: indicadoresDe(calculo),
            avisos: calculo.avisos.slice(0, 10),
            pendencias: pendenciasDe(dados),
          });
          return { ...dados, reaproveitado: false };
        });
      } catch (erro) {
        if (erro instanceof EmAndamento)
          return { estado: "em_andamento", chave, motivo: erro.message };
        throw erro;
      }
    },

    async salvar_relatorio({ chave, texto } = {}) {
      if (!RE_CHAVE.test(String(chave)))
        return { estado: "erro_de_parametro", motivo: "Chave inválida." };
      const execucao = await lerExecucao(config.pastaTrabalho, chave);
      if (!execucao.dados) {
        return {
          estado: "erro_de_parametro",
          motivo: "Chave desconhecida: rode calcular_fechamento antes.",
        };
      }
      if (execucao.temRelatorio) {
        return {
          estado: "concluido",
          chave,
          arquivo: `relatorios/${chave}.md`,
          jaExistia: true,
        };
      }
      if (estadoAtual(execucao, agora()) === "cancelado") {
        return {
          estado: "cancelado",
          chave,
          motivo: "Esta execução foi cancelada.",
        };
      }
      const d = execucao.dados;
      await gravarRelatorio(
        config.pastaTrabalho,
        chave,
        montarRelatorio(d, String(texto ?? "").slice(0, 8000)),
      );
      await marcarEstado(config.pastaTrabalho, chave, "concluido", agora());
      await registrar({
        tipo: "execucao",
        chave,
        estado: "concluido",
        fonte: d.arquivo,
        periodo: d.periodo,
        indicadores: indicadoresDe(d),
        avisos: d.avisos.slice(0, 10),
        pendencias: pendenciasDe(d),
      });
      return {
        estado: "concluido",
        chave,
        arquivo: `relatorios/${chave}.md`,
        jaExistia: false,
      };
    },

    async salvar_rascunho({ titulo, conteudo, chave } = {}) {
      const tituloLimpo = limparTexto(titulo).texto.slice(0, 80);
      const corpo = String(conteudo ?? "").slice(0, 4000);
      if (tituloLimpo.length < 3 || !corpo.trim()) {
        return {
          estado: "erro_de_parametro",
          motivo: "Rascunho precisa de título (3 a 80 letras) e conteúdo.",
        };
      }
      const hash = resumo(tituloLimpo, corpo);
      await mkdir(rascunhos, { recursive: true });
      const existente = (await readdir(rascunhos)).find((n) =>
        n.endsWith(`_${hash.slice(0, 8)}.md`),
      );
      if (existente)
        return {
          estado: "preparado",
          arquivo: `rascunhos/${existente}`,
          jaExistia: true,
        };

      const nome = `${hojeEmSaoPaulo(agora())}_${slug(tituloLimpo) || "rascunho"}_${hash.slice(0, 8)}.md`;
      const origem = RE_CHAVE.test(String(chave))
        ? ` · a partir do fechamento ${chave}`
        : "";
      await writeFile(
        path.join(rascunhos, nome),
        [
          "RASCUNHO — nada foi executado",
          "",
          `# ${tituloLimpo}`,
          `Preparado em ${quandoBr.format(agora())}${origem}`,
          "",
          corpo,
          "",
          "---",
          "Para executar qualquer coisa daqui, é o responsável quem faz, no sistema certo.",
          "",
        ].join("\n"),
        "utf8",
      );
      await registrar({
        tipo: "execucao",
        chave: `rascunho:${hash}`,
        estado: "preparado",
        detalhe: tituloLimpo,
        pendencias: [`Rascunho esperando decisão: ${tituloLimpo}`],
      });
      return {
        estado: "preparado",
        arquivo: `rascunhos/${nome}`,
        jaExistia: false,
      };
    },

    async cancelar_execucao({ chave } = {}) {
      if (!RE_CHAVE.test(String(chave)))
        return { estado: "erro_de_parametro", motivo: "Chave inválida." };
      const execucao = await lerExecucao(config.pastaTrabalho, chave);
      if (!execucao.dados)
        return { estado: "erro_de_parametro", motivo: "Chave desconhecida." };
      if (execucao.temRelatorio) {
        return {
          estado: "concluido",
          chave,
          motivo: "Já virou relatório; não há o que cancelar.",
        };
      }
      await marcarEstado(config.pastaTrabalho, chave, "cancelado", agora());
      await registrar({
        tipo: "execucao",
        chave,
        estado: "cancelado",
        fonte: execucao.dados.arquivo,
        periodo: execucao.dados.periodo,
      });
      return { estado: "cancelado", chave };
    },
  };

  async function chamar(nome, args) {
    const tratador = tratadores[nome];
    if (!tratador)
      throw new Error(`Ferramenta desconhecida: ${String(nome).slice(0, 60)}`);
    return tratador(args ?? {});
  }

  return { definicoes: DEFINICOES, chamar };
}

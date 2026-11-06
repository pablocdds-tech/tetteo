import { tipoDocumentoNota, LeituraNotaRecusada } from "./documento";
import { lerXmlFiscal } from "./xml";
import { extrairPdfFiscal } from "./pdf";
import { lerTextoFiscal } from "./texto";
import { lerQrFiscal } from "./qr";
import { prepararImagemNota, recortesDaNota, type ImagemNota } from "./imagem";
import { consultaFiscalDesativada, type ConsultaFiscal } from "./consulta";
import {
  extracaoVazia,
  confiancas,
  validarExtracaoFiscal,
  type ExtracaoFiscal,
  type MetodoLeitura,
  type PendenciaFiscal,
} from "./extracao";
import { dadosDaChave, chaveFiscalValida } from "@/lib/documento-fiscal";
export type EventoPipeline = {
  etapa: string;
  metodo?: MetodoLeitura;
  codigos?: string[];
  arquivos?: string[];
  tentativa?: number;
  modelo?: string;
  tokens?: number;
};
export type ResultadoFiscal = {
  dados: ExtracaoFiscal;
  metodo: MetodoLeitura;
  pendencias: PendenciaFiscal[];
  extras: PendenciaFiscal[];
  artefatos: { id: string; variante: string }[];
  versao: "fiscal-2.0";
};
export async function lerDocumentoFiscal(
  bytes: Uint8Array,
  opcoes: {
    organizacaoId: string;
    unidadeId: string;
    consulta?: ConsultaFiscal;
    registrar?: (e: EventoPipeline) => Promise<void>;
    salvar?: (i: ImagemNota) => Promise<string>;
    gemini?: (
      imagens: ImagemNota[],
      recortes: () => Promise<ImagemNota[]>,
    ) => Promise<{ dados: ExtracaoFiscal; extras: PendenciaFiscal[] }>;
  },
): Promise<ResultadoFiscal> {
  const registrar = opcoes.registrar ?? (async () => {}),
    tipo = tipoDocumentoNota(bytes),
    artefatos: ResultadoFiscal["artefatos"] = [];
  const concluir = async (
    dados: ExtracaoFiscal,
    metodo: MetodoLeitura,
    extras: PendenciaFiscal[] = [],
  ): Promise<ResultadoFiscal> => {
    const pendencias = [...validarExtracaoFiscal(dados), ...extras];
    await registrar({
      etapa: "VALIDACAO",
      metodo,
      codigos: pendencias.map((p) => p.codigo),
    });
    return {
      dados,
      metodo,
      pendencias,
      extras,
      artefatos,
      versao: "fiscal-2.0",
    };
  };
  if (!tipo)
    throw new LeituraNotaRecusada(
      "TIPO_INVALIDO",
      "Envie XML, PDF, JPG, PNG ou WebP de até 20 MB.",
    );
  await registrar({ etapa: "ARQUIVO_VALIDADO" });
  if (tipo === "application/xml") {
    await registrar({ etapa: "XML", metodo: "XML" });
    return concluir(lerXmlFiscal(bytes), "XML");
  }
  let imagens: ImagemNota[];
  if (tipo === "application/pdf") {
    const p = await extrairPdfFiscal(bytes);
    await registrar({ etapa: "PDF_EXTRAIDO", metodo: "PDF_TEXTO" });
    if (p.texto.replace(/\s/g, "").length >= 60)
      return concluir(lerTextoFiscal(p.texto), "PDF_TEXTO");
    imagens = p.paginas.map((b, i) => ({
      bytes: b,
      tipo: "image/png",
      variante: `pagina-${i + 1}`,
    }));
  } else imagens = [{ bytes, tipo, variante: "original" }];
  if (!imagens.length)
    throw new LeituraNotaRecusada(
      "IMAGEM_AUSENTE",
      "O PDF não contém texto ou imagem legível. Envie o XML.",
    );
  const processadas: ImagemNota[] = [],
    chaves = new Set<string>();
  let ruins = 0;
  for (const [n, imagem] of imagens.entries()) {
    const qr = await lerQrFiscal(imagem.bytes);
    if (qr) chaves.add(qr.chave);
    const a = await prepararImagemNota(imagem.bytes),
      processada = { ...a.processada, variante: `pagina-${n + 1}-processada` };
    if (opcoes.salvar) {
      const id = await opcoes.salvar(processada);
      artefatos.push({ id, variante: processada.variante });
      await registrar({ etapa: "IMAGEM_PROCESSADA", arquivos: [id] });
    }
    processadas.push(processada);
    if (!qr) {
      const q = await lerQrFiscal(processada.bytes);
      if (q) chaves.add(q.chave);
    }
    if (a.ruim) ruins++;
  }
  if (chaves.size > 1)
    throw new LeituraNotaRecusada(
      "MULTIPLAS_NOTAS",
      "Encontrei mais de uma chave fiscal. Envie uma nota por vez.",
    );
  if (chaves.size) {
    const chave = [...chaves][0];
    await registrar({ etapa: "QR_LIDO", metodo: "QR" });
    if (!chaveFiscalValida(chave))
      throw new LeituraNotaRecusada(
        "QR_INVALIDO",
        "A chave lida no QR Code não passou na validação. Envie o XML ou uma foto mais nítida do código.",
      );
    const resposta = await (
      opcoes.consulta ?? consultaFiscalDesativada
    ).consultar({
      chave,
      organizacaoId: opcoes.organizacaoId,
      unidadeId: opcoes.unidadeId,
    });
    if (resposta.estado === "DISPONIVEL") {
      const d = lerXmlFiscal(resposta.xml);
      if (d.chave_acesso !== chave)
        throw new LeituraNotaRecusada(
          "CONSULTA_DIVERGENTE",
          "A consulta retornou outro documento. Confira o provedor fiscal.",
        );
      return concluir(d, "QR");
    }
    const d = extracaoVazia(),
      k = dadosDaChave(chave);
    d.chave_acesso = chave;
    d.cnpj_emitente = k?.cnpj ?? null;
    d.numero = k ? String(Number(k.numero)) : null;
    d.serie = k ? String(Number(k.serie)) : null;
    d.confianca = confiancas(1);
    const mensagem =
      resposta.estado === "DESATIVADA"
        ? "Li o QR Code. A consulta externa está desativada até você escolher o provedor. Envie o XML para obter os itens sem OCR."
        : "Li o QR Code, mas a consulta não disponibilizou os itens. Envie o XML original.";
    return concluir(d, "QR", [
      { campo: "consulta", codigo: resposta.estado, mensagem },
    ]);
  }
  if (ruins === imagens.length)
    throw new LeituraNotaRecusada(
      "IMAGEM_RUIM",
      "A imagem está sem detalhes suficientes. Envie o cupom esticado, com boa luz, sem sombras e enquadrado inteiro. Prefira enviar como documento, sem compressão.",
    );
  await registrar({ etapa: "QR_NAO_DECODIFICADO", metodo: "GEMINI" });
  if (!opcoes.gemini)
    throw new LeituraNotaRecusada(
      "IA_CONFIGURACAO",
      "A leitura visual precisa da IA configurada. Envie o XML ou PDF com texto.",
    );
  // Original + derivado, quando cabem, sem reamostragem ou redução da resolução.
  const ambos = [...imagens, ...processadas],
    entrada =
      ambos.reduce((s, i) => s + i.bytes.length, 0) <= 16 * 1024 * 1024
        ? ambos
        : imagens;
  const r = await opcoes.gemini(entrada, async () => {
    const recortes = await recortesDaNota(processadas);
    if (opcoes.salvar)
      for (const i of recortes) {
        const id = await opcoes.salvar(i);
        artefatos.push({ id, variante: i.variante });
        await registrar({ etapa: "RECORTE", arquivos: [id] });
      }
    return recortes;
  });
  return concluir(r.dados, "GEMINI", r.extras);
}

import { NextResponse } from "next/server";

import { obterContexto, pode } from "@/core/sessao/contexto";
import { ArquivoRecusado, LIMITE_BYTES, gravarArquivo } from "@/server/arquivos";

/**
 * POST /api/arquivos — envio de foto.
 *
 * Cada FINALIDADE diz quem pode enviar e quem pode ver depois. Não existe
 * envio "genérico": um arquivo sem finalidade conhecida é recusado, e a foto
 * nasce presa à loja ativa de quem enviou.
 */

const FINALIDADES = {
  "foto-recebimento": { exigir: "compras.receber", ler: "compras.ver" },
} as const;

type Finalidade = keyof typeof FINALIDADES;

export async function POST(request: Request) {
  const ctx = await obterContexto();
  if (!ctx) return NextResponse.json({ erro: "Entre no sistema." }, { status: 401 });

  let dados: FormData;
  try {
    dados = await request.formData();
  } catch {
    return NextResponse.json({ erro: "Envio sem arquivo." }, { status: 400 });
  }

  const finalidade = String(dados.get("finalidade") ?? "") as Finalidade;
  const regra = FINALIDADES[finalidade];
  if (!regra) return NextResponse.json({ erro: "Finalidade desconhecida." }, { status: 400 });
  if (!pode(ctx, regra.exigir)) {
    return NextResponse.json({ erro: "Seu perfil não pode enviar esta foto." }, { status: 403 });
  }
  if (!ctx.unidadeAtiva) {
    return NextResponse.json({ erro: "Escolha a loja antes de enviar a foto." }, { status: 400 });
  }

  const arquivo = dados.get("arquivo");
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ erro: "Envio sem arquivo." }, { status: 400 });
  }
  // Recusa pelo tamanho declarado ANTES de ler o conteúdo para a memória.
  if (arquivo.size > LIMITE_BYTES) {
    return NextResponse.json({ erro: "A foto passa de 5 MB." }, { status: 413 });
  }

  try {
    const salvo = await gravarArquivo({
      organizacaoId: ctx.organizacao.id,
      unidadeId: ctx.unidadeAtiva.id,
      enviadoPorId: ctx.usuario.id,
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
      nomeOriginal: arquivo.name,
      permissaoLeitura: regra.ler,
    });
    return NextResponse.json({ id: salvo.id });
  } catch (erro) {
    if (erro instanceof ArquivoRecusado) {
      return NextResponse.json({ erro: erro.message }, { status: 400 });
    }
    console.error("POST /api/arquivos:", erro);
    return NextResponse.json({ erro: "Não deu para guardar a foto." }, { status: 500 });
  }
}

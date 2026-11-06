import { obterContexto } from "@/core/sessao/contexto";
import {
  exigirAcessoRascunho,
  receberRascunhoFiscal,
  salvarRascunhoFiscal,
  obterRascunhoFiscal,
  listarRascunhosFiscais,
} from "@/modules/assistente/services/rascunhos-fiscais";
import { criarManipuladorRascunhos } from "./manipulador";

const manipular = criarManipuladorRascunhos({
  contexto: obterContexto,
  autorizar: exigirAcessoRascunho,
  receber: receberRascunhoFiscal,
  salvar: salvarRascunhoFiscal,
  obter: obterRascunhoFiscal,
  listar: listarRascunhosFiscais,
});
export const GET = manipular;
export const POST = manipular;
export const PATCH = manipular;

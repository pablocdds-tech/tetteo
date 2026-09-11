/**
 * O QUE ESTÁ CONFIGURADO — e, principalmente, o que falta.
 *
 * Os segredos moram só no ambiente do servidor (Dokploy em produção,
 * `.env.local` na máquina). Esta é a única porta por onde o conector os lê, e
 * ela devolve o que falta PELO NOME da variável, nunca pelo valor. É o que a
 * tela mostra como "configuração pendente".
 *
 * Função pura sobre um objeto de ambiente: o teste passa o que quiser, e
 * ninguém precisa mexer no `process.env` de verdade para provar nada.
 */

type Ambiente = Record<string, string | undefined>;

/** A Evolution, por dentro da rede do Docker. Não é segredo. */
const URL_PADRAO = "http://evolution_api:8080";

/**
 * A senha do webhook assina o passe que prova que foi a Evolution quem
 * chamou. Curta, dá para adivinhar — e aí qualquer um "é" a Evolution.
 */
const TAMANHO_MINIMO_DA_SENHA = 16;

function valor(env: Ambiente, nome: string): string {
  return (env[nome] ?? "").trim();
}

function ehHttp(url: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(url);
}

export type ConfigEvolution =
  | { tipo: "ok"; url: string; instancia: string; chave: string }
  | { tipo: "pendente"; faltando: string[] };

/**
 * `EVOLUTION_API_KEY` é a chave DA INSTÂNCIA. Na 2.3.7 ela vale em toda rota
 * com `{instance}` no caminho — estado, QR, webhook, envio, consulta — e só
 * para aquela instância. A chave global fica dentro da Evolution; o Tetteo
 * não precisa dela para nada.
 */
export function configuracaoEvolution(env: Ambiente): ConfigEvolution {
  const url = (valor(env, "EVOLUTION_URL") || URL_PADRAO).replace(/\/+$/, "");
  const instancia = valor(env, "EVOLUTION_INSTANCIA");
  const chave = valor(env, "EVOLUTION_API_KEY");

  const faltando: string[] = [];
  if (!ehHttp(url)) faltando.push("EVOLUTION_URL");
  if (!instancia) faltando.push("EVOLUTION_INSTANCIA");
  if (!chave) faltando.push("EVOLUTION_API_KEY");

  if (faltando.length > 0) return { tipo: "pendente", faltando };
  return { tipo: "ok", url, instancia, chave };
}

/**
 * As senhas que o webhook aceita, a atual primeiro.
 *
 * A anterior existe só durante a troca: a Evolution continua assinando com a
 * velha até alguém reaplicar a configuração de eventos, e nenhum webhook pode
 * cair nesse meio-tempo.
 */
export function chavesDoWebhook(env: Ambiente): string[] {
  return ["WHATSAPP_WEBHOOK_CHAVE", "WHATSAPP_WEBHOOK_CHAVE_ANTERIOR"]
    .map((nome) => valor(env, nome))
    .filter((senha) => senha.length >= TAMANHO_MINIMO_DA_SENHA);
}

export type ConfigWebhook =
  | { tipo: "ok"; url: string; chave: string; chaves: string[] }
  | { tipo: "pendente"; faltando: string[] };

/** O que é preciso para APLICAR a configuração de eventos na Evolution. */
export function configuracaoWebhook(env: Ambiente): ConfigWebhook {
  const url = valor(env, "WHATSAPP_WEBHOOK_URL");
  const chave = valor(env, "WHATSAPP_WEBHOOK_CHAVE");

  const faltando: string[] = [];
  if (!ehHttp(url)) faltando.push("WHATSAPP_WEBHOOK_URL");
  if (chave.length < TAMANHO_MINIMO_DA_SENHA) {
    faltando.push("WHATSAPP_WEBHOOK_CHAVE");
  }

  if (faltando.length > 0) return { tipo: "pendente", faltando };
  return { tipo: "ok", url, chave, chaves: chavesDoWebhook(env) };
}

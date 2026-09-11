import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * O CONTRASTE DAS CORES, CONFERIDO PELA MÁQUINA.
 *
 * Contraste é a única regra de design que dá para PROVAR — e por isso é a única
 * que não tem desculpa para ficar quebrada. Todas as outras dependem de alguém
 * abrir a tela e olhar; esta some no meio de um `git diff` de três linhas e só
 * reaparece no dia em que alguém não consegue ler o rodapé de uma nota.
 *
 * Este teste já pegou sete pares reprovados na primeira execução, entre eles a
 * etiqueta verde (4,37:1) e a borda dos campos (1,55:1) — nenhum deles parecia
 * errado a olho nu.
 *
 * A conta é a da WCAG 2.2: luminância relativa com gama, e (claro + 0,05) /
 * (escuro + 0,05).
 *
 *   4,5:1  texto normal          (AA, critério 1.4.3)
 *   3,0:1  borda de campo, foco  (AA, critério 1.4.11 — componentes de tela)
 *
 * Só entram pares que EXISTEM na interface. Testar toda combinação possível
 * geraria falhas em pares que ninguém usa, e a resposta a um teste que grita
 * sem motivo é desligá-lo.
 */

const CSS = readFileSync("src/app/globals.css", "utf-8");

function tokensDoTema(seletor: string): Record<string, string> {
  const inicio = CSS.indexOf(seletor);
  assert.notEqual(inicio, -1, `Bloco de tema não encontrado: ${seletor}`);

  const abre = CSS.indexOf("{", inicio);
  const fecha = CSS.indexOf("}", abre);
  const corpo = CSS.slice(abre + 1, fecha);

  const tokens: Record<string, string> = {};
  for (const [, nome, cor] of corpo.matchAll(
    /(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    tokens[nome] = cor;
  }
  return tokens;
}

/** Luminância relativa da WCAG — não é o mesmo que "quão claro parece". */
function luminancia(hex: string) {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2);
}

function contraste(frente: string, fundo: string) {
  const a = luminancia(frente);
  const b = luminancia(fundo);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** [frente, fundo, mínimo exigido, onde isso aparece na tela] */
const PARES: [string, string, number, string][] = [
  ["--ink", "--surface", 4.5, "texto principal no cartão"],
  ["--ink", "--paper", 4.5, "texto principal no fundo da página"],
  ["--ink", "--surface-2", 4.5, "texto principal na barra e nos campos"],
  ["--ink", "--surface-3", 4.5, "texto principal no item ativo do menu"],

  ["--ink-2", "--surface", 4.5, "texto secundário no cartão"],
  ["--ink-2", "--paper", 4.5, "texto secundário no fundo"],
  ["--ink-2", "--surface-2", 4.5, "texto secundário na barra"],
  ["--ink-2", "--surface-3", 4.5, "etiqueta 'em breve' no menu"],

  ["--ink-3", "--surface", 4.5, "apoio do indicador, rótulo de coluna"],
  ["--ink-3", "--paper", 4.5, "apoio direto no fundo da página"],
  ["--ink-3", "--surface-2", 4.5, "texto do botão de busca no topo"],

  ["--accent-ink", "--accent", 4.5, "texto dentro do botão primário"],
  ["--accent", "--surface", 4.5, "link de ação no cartão"],
  ["--accent", "--paper", 4.5, "link de ação no fundo"],
  ["--accent", "--accent-sub", 4.5, "destino ativo da barra lateral"],
  ["--accent", "--surface", 3.0, "anel de foco de teclado no cartão"],
  ["--accent", "--surface-2", 3.0, "anel de foco na barra lateral"],

  ["--ok", "--ok-sub", 4.5, "etiqueta 'Quitada'"],
  ["--warn", "--warn-sub", 4.5, "etiqueta 'Em aberto', aviso sem conexão"],
  ["--bad", "--bad-sub", 4.5, "etiqueta 'Vencida', 'Atrasada'"],
  ["--info", "--info-sub", 4.5, "etiqueta 'A receber'"],

  ["--ok", "--surface", 4.5, "valor positivo na tabela"],
  ["--warn", "--surface", 4.5, "texto de aviso no cartão"],
  ["--bad", "--surface", 4.5, "saldo negativo na projeção"],
  ["--info", "--surface", 4.5, "texto informativo no cartão"],
  ["--ok", "--paper", 4.5, "texto positivo no fundo"],
  ["--bad", "--paper", 4.5, "texto de erro no fundo"],

  // 1.4.11: a BORDA é o que identifica onde o campo começa e termina.
  ["--line-2", "--surface", 3.0, "borda de campo e de botão secundário"],
  ["--line-2", "--paper", 3.0, "borda de campo sobre o fundo da página"],
  ["--line-2", "--surface-2", 3.0, "borda dentro da barra lateral"],

  // O texto DENTRO dos botões Sim/Não/N/A marcados da folha de checklist.
  // Era branco, e no tema escuro dava 2,2:1, 2,8:1 e 2,0:1 — o verde, o
  // vermelho e o cinza clareiam no escuro, e branco em cima de cor clara some.
  // `--surface` inverte sozinho: quase branco no claro, quase preto no escuro.
  ["--surface", "--ok", 4.5, "botão 'Sim' marcado na folha"],
  ["--surface", "--bad", 4.5, "botão 'Não' marcado na folha"],
  ["--surface", "--ink-2", 4.5, "botão 'N/A' marcado na folha"],
];

for (const seletor of [
  ':root[data-theme="light"]',
  ':root[data-theme="dark"]',
]) {
  const tema = tokensDoTema(seletor);
  const nome = seletor.includes("dark") ? "escuro" : "claro";

  test(`tema ${nome}: todo par de cor usado na tela passa na WCAG AA`, () => {
    const reprovados: string[] = [];

    for (const [frente, fundo, minimo, onde] of PARES) {
      assert.ok(tema[frente], `Token ausente no tema ${nome}: ${frente}`);
      assert.ok(tema[fundo], `Token ausente no tema ${nome}: ${fundo}`);

      const razao = contraste(tema[frente], tema[fundo]);
      if (razao < minimo) {
        reprovados.push(
          `${frente} sobre ${fundo} = ${razao.toFixed(2)}:1, ` +
            `precisa de ${minimo}:1 — ${onde}`,
        );
      }
    }

    assert.deepEqual(
      reprovados,
      [],
      `Contraste insuficiente no tema ${nome}:\n  ${reprovados.join("\n  ")}`,
    );
  });
}

/**
 * Os dois caminhos para o mesmo tema precisam dar na mesma cor.
 *
 * O tema escuro é escrito duas vezes: uma para quem tem o computador no escuro
 * (`prefers-color-scheme`) e outra para quem escolheu escuro no sistema
 * (`data-theme`). Editar só uma delas é o erro mais fácil de cometer aqui, e o
 * sintoma — "no meu computador está certo" — é o mais difícil de reproduzir.
 */
test("o tema escuro é igual nos dois caminhos que levam até ele", () => {
  const porEscolha = tokensDoTema(':root[data-theme="dark"]');
  const porPreferencia = tokensDoTema("@media (prefers-color-scheme: dark)");

  assert.deepEqual(
    porEscolha,
    porPreferencia,
    "As cores do tema escuro divergiram entre @media e data-theme.",
  );
});

test("o tema claro é igual no padrão e na escolha explícita", () => {
  const padrao = tokensDoTema(":root {");
  const porEscolha = tokensDoTema(':root[data-theme="light"]');

  // O `:root` padrão carrega só as cores; as medidas da casca vêm em outro
  // bloco. Comparamos apenas o que os dois têm em comum.
  for (const [nome, cor] of Object.entries(porEscolha)) {
    assert.equal(
      padrao[nome],
      cor,
      `O token ${nome} difere entre o padrão e data-theme="light".`,
    );
  }
});

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier/flat";

/**
 * ============================================================================
 * AS TRAVAS ARQUITETURAIS
 * ============================================================================
 *
 * Estrutura de pasta não impede ninguém de fazer besteira — ela só torna a
 * besteira visível. Estas regras fazem o projeto RECUSAR A COMPILAR quando
 * alguém atravessa uma fronteira que combinamos não atravessar.
 *
 * Sem elas, em seis meses a arquitetura existe só no papel, e "só dessa vez,
 * é mais rápido assim" vira a arquitetura real do código.
 *
 * As camadas, da mais alta para a mais baixa:
 *
 *   app            roteamento — só casca e delegação
 *   modules        os Apps do Tetteo (Cardápio, Estoque, …)
 *   connectors     pontes com sistemas externos (PDV, iFood)
 *   core           o Kernel — não conhece nenhum App
 *   server         banco, eventos, autorização
 *   design-system  os tijolos visuais — não conhece negócio
 *   lib            utilitários genéricos — não importa de ninguém
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    plugins: { boundaries },

    settings: {
      "boundaries/include": ["src/**/*.{ts,tsx,js,jsx,mjs}"],
      "boundaries/elements": [
        { type: "app", pattern: "src/app/**" },
        // `capture` guarda o nome do módulo para a regra "só pode importar de
        // si mesmo", mais abaixo.
        { type: "module", pattern: "src/modules/*", capture: ["nome"] },
        { type: "connector", pattern: "src/connectors/**" },
        { type: "core", pattern: "src/core/**" },
        { type: "server", pattern: "src/server/**" },
        { type: "design-system", pattern: "src/design-system/**" },
        { type: "lib", pattern: "src/lib/**" },
      ],
    },

    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          message:
            "Fronteira violada: {{from.element.type}} não pode importar de {{target.element.type}}. Veja o README da pasta.",
          policies: [
            // O roteamento é a casca: pode montar qualquer coisa.
            {
              from: { element: { type: "app" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "app",
                        "core",
                        "module",
                        "design-system",
                        "lib",
                        "server",
                        "connector",
                      ],
                    },
                  },
                },
              },
            },

            // A REGRA CENTRAL: um App só importa de si mesmo.
            // Para falar com outro App existem eventos e dados centrais.
            {
              from: { element: { type: "module" } },
              allow: {
                to: {
                  element: {
                    type: "module",
                    captured: { nome: "{{from.element.captured.nome}}" },
                  },
                },
              },
            },
            {
              from: { element: { type: "module" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: ["core", "design-system", "lib", "server"],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "module" } },
              disallow: { to: { element: { type: "module" } } },
              message:
                "Um App nunca importa de outro App. Use um evento (events/) ou um dado central (server/).",
            },

            // O Core não conhece nenhum App. O único contato é o App Registry,
            // que lê os manifestos que os próprios Apps declaram.
            {
              from: { element: { type: "core" } },
              allow: {
                to: {
                  element: {
                    types: {
                      anyOf: ["core", "design-system", "lib", "server"],
                    },
                  },
                },
              },
            },
            {
              from: { element: { type: "core" } },
              disallow: { to: { element: { type: "module" } } },
              message:
                "O Core não conhece Apps. Se ele precisa de algo de um App, quem declara é o manifesto do App.",
            },

            // Conectores traduzem o mundo externo em eventos. Não conhecem Apps.
            {
              from: { element: { type: "connector" } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ["connector", "core", "lib", "server"] },
                  },
                },
              },
            },
            {
              from: { element: { type: "connector" } },
              disallow: { to: { element: { type: "module" } } },
              message:
                "Conector não fala com App. Ele publica um evento — quem se interessa, escuta.",
            },

            // A camada de dados é a base do servidor.
            {
              from: { element: { type: "server" } },
              allow: {
                to: { element: { types: { anyOf: ["server", "lib"] } } },
              },
            },

            // Os tijolos visuais não conhecem negócio.
            {
              from: { element: { type: "design-system" } },
              allow: {
                to: { element: { types: { anyOf: ["design-system", "lib"] } } },
              },
            },
            {
              from: { element: { type: "design-system" } },
              disallow: {
                to: { element: { types: { anyOf: ["module", "core"] } } },
              },
              message:
                "Componente do Design System não conhece negócio. Se ele precisa, o lugar dele é core/ ou dentro de um App.",
            },

            // A camada mais baixa: não importa de ninguém dentro de src/.
            {
              from: { element: { type: "lib" } },
              allow: { to: { element: { type: "lib" } } },
            },
            {
              from: { element: { type: "lib" } },
              disallow: {
                to: {
                  element: {
                    types: {
                      anyOf: [
                        "module",
                        "core",
                        "server",
                        "design-system",
                        "connector",
                      ],
                    },
                  },
                },
              },
              message:
                "Se um utilitário precisou importar do Core ou de um módulo, ele não era um utilitário.",
            },
          ],
        },
      ],
    },
  },

  // Prettier por último: desliga as regras de formatação que brigariam com ele.
  prettier,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Ferramental de IA instalado na pasta — não é código do Tetteo.
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".impeccable/**",
  ]),
]);

export default eslintConfig;

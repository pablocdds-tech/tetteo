import bcrypt from "bcryptjs";
import type pg from "pg";

/**
 * AS PESSOAS E LOJAS DE ENSAIO.
 *
 * Cada uma existe para um caso da regra de permissão:
 *   dono      acesso de REDE com papel '*'           → vê todas as lojas ativas
 *   gerente   acesso da loja Centro, 'financeiro.ver' → vê só o Centro
 *   caixa     acesso da loja Centro, sem financeiro   → não vê nenhuma
 *   suspenso  pessoa suspensa                         → nem entra
 * A "Loja Fechada" está inativa: nem o dono a enxerga.
 */

export const SENHA_DE_ENSAIO = "senha-de-ensaio-123";

export const PESSOAS = {
  dono: "dono@ensaio.test",
  gerente: "gerente@ensaio.test",
  caixa: "caixa@ensaio.test",
  suspenso: "suspenso@ensaio.test",
} as const;

export const LOJAS = {
  centro: { id: "uni_centro", nome: "Vitaliano Centro" },
  sul: { id: "uni_sul", nome: "Vitaliano Zona Sul" },
} as const;

export async function semear(admin: pg.Client): Promise<void> {
  // Custo 4: é teste. Produção usa o custo 12 do Tetteo.
  const hash = await bcrypt.hash(SENHA_DE_ENSAIO, 4);

  await admin.query(`
    INSERT INTO organizacao (id, nome, slug, "atualizadoEm")
      VALUES ('org_ensaio', 'Vitaliano', 'vitaliano', now());
    INSERT INTO unidade (id, "organizacaoId", nome, codigo, "atualizadoEm") VALUES
      ('uni_centro', 'org_ensaio', 'Vitaliano Centro', 'CEN', now()),
      ('uni_sul', 'org_ensaio', 'Vitaliano Zona Sul', 'SUL', now()),
      ('uni_fechada', 'org_ensaio', 'Loja Fechada', 'FEC', now());
    UPDATE unidade SET ativa = false WHERE id = 'uni_fechada';
    INSERT INTO papel (id, "organizacaoId", nome, "atualizadoEm") VALUES
      ('pap_diretor', 'org_ensaio', 'Diretor', now()),
      ('pap_gerente', 'org_ensaio', 'Gerente', now()),
      ('pap_caixa', 'org_ensaio', 'Caixa', now());
    INSERT INTO papel_permissao (id, "papelId", chave) VALUES
      ('pp_1', 'pap_diretor', '*'),
      ('pp_2', 'pap_gerente', 'financeiro.ver'),
      ('pp_3', 'pap_caixa', 'checklists.ver');
  `);

  await admin.query(
    `INSERT INTO usuario (id, nome, email, "senhaHash", status, "atualizadoEm") VALUES
      ('usr_dono', 'Dono', 'dono@ensaio.test', $1, 'ATIVO', now()),
      ('usr_gerente', 'Gerente', 'gerente@ensaio.test', $1, 'ATIVO', now()),
      ('usr_caixa', 'Caixa', 'caixa@ensaio.test', $1, 'ATIVO', now()),
      ('usr_suspenso', 'Suspenso', 'suspenso@ensaio.test', $1, 'SUSPENSO', now())`,
    [hash],
  );

  await admin.query(`
    INSERT INTO acesso (id, "usuarioId", "organizacaoId", "unidadeId", "papelId", "atualizadoEm") VALUES
      ('ac_dono', 'usr_dono', 'org_ensaio', NULL, 'pap_diretor', now()),
      ('ac_gerente', 'usr_gerente', 'org_ensaio', 'uni_centro', 'pap_gerente', now()),
      ('ac_caixa', 'usr_caixa', 'org_ensaio', 'uni_centro', 'pap_caixa', now()),
      ('ac_suspenso', 'usr_suspenso', 'org_ensaio', 'uni_centro', 'pap_gerente', now());
  `);
}

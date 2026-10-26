/** A permissão de uma rede nunca concede acesso em outra rede. */
export function acessosNaOrganizacao<
  T extends {
    organizacaoId: string;
    papel: { organizacaoId: string };
    unidade: {
      organizacaoId: string;
      ativa: boolean;
      excluidoEm: Date | null;
    } | null;
  },
>(acessos: T[], organizacaoId: string): T[] {
  return acessos.filter(
    (a) =>
      a.organizacaoId === organizacaoId &&
      a.papel.organizacaoId === organizacaoId &&
      (a.unidade === null ||
        (a.unidade.organizacaoId === organizacaoId &&
          a.unidade.ativa &&
          a.unidade.excluidoEm === null)),
  );
}

/**
 * Erros que qualquer App precisa levantar.
 *
 * Ficam em `lib` para que a mensagem chegue igual em todo lugar e para que o
 * `catch` das ações de formulário reconheça o mesmo tipo, venha o erro do
 * Cardápio ou do Estoque.
 */

/**
 * Levantado quando a pessoa não tem a permissão exigida.
 *
 * A mensagem completa a frase "Você não tem permissão para ___", então o texto
 * passado deve descrever a AÇÃO ("fechar contagens"), não a permissão
 * ("estoque.contar") — quem lê é a pessoa, não o programador.
 */
export class SemPermissao extends Error {
  constructor(acao: string) {
    super(`Você não tem permissão para ${acao}.`);
    this.name = "SemPermissao";
  }
}

/**
 * Levantado quando a tela exige uma unidade e o usuário está vendo a rede.
 *
 * Estoque é físico: farinha na câmara fria de uma loja não vira pizza na
 * outra. Contar "a rede" não significa nada.
 */
export class ExigeUnidade extends Error {
  constructor() {
    super("Escolha uma unidade para continuar.");
    this.name = "ExigeUnidade";
  }
}

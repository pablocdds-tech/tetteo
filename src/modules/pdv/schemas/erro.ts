/** Uma rejeição de negócio conhecida; falhas de infraestrutura permanecem ambíguas. */
export class ErroPdv extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPdv";
  }
}

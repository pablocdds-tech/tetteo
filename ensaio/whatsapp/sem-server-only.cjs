// O ENSAIO RODA FORA DO NEXT — e o pacote `server-only` existe justamente
// para explodir fora do servidor do Next. Aqui ele é trocado por um módulo
// vazio, ANTES de qualquer import, só neste processo de ensaio.
//
// Não serve de brecha para o app: o build do Next continua usando o pacote
// de verdade, e é ele que impede o registro de ferramentas de ir para o
// navegador.
const caminho = require.resolve("server-only");
require.cache[caminho] = {
  id: caminho,
  filename: caminho,
  loaded: true,
  exports: {},
};

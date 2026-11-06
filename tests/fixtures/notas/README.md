# Corpus fiscal de teste

Todos os arquivos deste diretório são **sintéticos**, gerados por
`npm run fixtures:notas`. Não são notas emitidas, fotos reais anonimizadas nem
documentos aptos para lançamento. Os dígitos verificadores válidos servem apenas
para testar os validadores; não houve consulta de cadastro ou autorização fiscal.

Os casos escuro, torto e dobrado são transformações simuladas do mesmo desenho.
O QR usa um domínio reservado `.invalid`, nunca consultado. O PDF digitalizado
contém uma imagem; o outro PDF contém texto selecionável. O XML é uma amostra
mínima de parsing, não um exemplo certificado por XSD/assinatura digital.

`manifest.json` contém o gabarito. O avaliador informa a proveniência e não mede
acurácia visual quando Gemini não foi explicitamente habilitado. Amostras reais
anonimizadas serão fornecidas posteriormente pelo responsável, com revisão de
gabarito e remoção de CNPJ/CPF, chave/QR, endereços e identificadores privados.
Variações sintéticas nunca devem ser classificadas como amostras reais.

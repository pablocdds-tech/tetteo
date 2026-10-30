# Banco Inter PJ

Transporte de consulta por OAuth2 + mTLS usando `node:https`. O conector não
importa módulos de negócio e não possui endpoints de pagamento. Retorna
`TransacaoBancaria`, um contrato interno sem certificados ou tokens.

Normalização e matcher têm testes separados. O processamento autorizado fica
no Financeiro; a composição entre as camadas está em `src/app/api/inter`.
Configuração, limites, documentação oficial e roteiro: [Financeiro Inter](../../../docs/financeiro-inter.md).

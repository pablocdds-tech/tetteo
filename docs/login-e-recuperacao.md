# Login, Google e recuperação de senha

O login tradicional continua em `/login`. A página inclui “Esqueci minha senha”
e “Continuar com Google”. Novas contas Google são criadas **sem qualquer acesso**
às organizações ou lojas; veem `/conta` até um administrador conceder acesso
em Configurações → Pessoas, usando o mesmo e-mail. Contas suspensas ou excluídas
não podem entrar nem redefinir senha.

## Ativar Google

1. Crie um projeto no Google Cloud e configure a tela de consentimento OAuth.
2. Crie uma credencial OAuth do tipo **Aplicativo da Web**.
3. Cadastre a URI exata `https://SEU_DOMINIO/api/auth/callback/google`.
   Para desenvolvimento, use `http://localhost:3000/api/auth/callback/google`.
4. Salve `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET` no ambiente do Dokploy.
5. Confirme `AUTH_URL` e `APP_URL` com o domínio público HTTPS e publique novamente.
6. Se o projeto Google estiver em modo de teste, inclua os e-mails autorizados
   como usuários de teste. Para abrir a todos, conclua a publicação exigida pelo Google.

O aplicativo solicita somente identidade, e-mail e nome. Exige `email_verified=true`.
O subject do Google é único e não pode ser reaproveitado em outra conta. Uma conta
ativa existente pode entrar com o Google que verifica o mesmo endereço de e-mail.
Não são solicitados Gmail, Drive nem acesso offline.

## Ativar recuperação de senha

1. Crie uma conta no Resend e verifique seu domínio remetente com os registros
   DNS indicados pelo serviço.
2. Gere uma chave de envio e salve `RESEND_API_KEY` no ambiente do Dokploy.
3. Configure `AUTH_EMAIL_FROM`, por exemplo `Tetteo <acesso@seudominio.com.br>`.
4. Confirme `APP_URL=https://SEU_DOMINIO` e publique novamente.
5. Solicite um link para uma conta de teste autorizada, confira a entrega,
   redefina a senha e confirme que o mesmo link não funciona novamente.

Sem essas configurações, as telas explicam a indisponibilidade e encaminham para
a redefinição administrativa. Nenhum envio é simulado como concluído.

Os links duram 30 minutos. Só o hash SHA-256 fica no banco. O uso é atômico,
invalida outros links e incrementa a versão da sessão para encerrar acessos anteriores.
A nova senha exige 12 caracteres e no máximo 72 bytes, limite do bcrypt. O token
não é registrado em logs da aplicação. A página de redefinição tem `no-referrer`
e não deve ser indexada. Não configure analytics ou gravação de URLs nesta rota;
se o proxy registrar URLs, remova o parâmetro `token` dos logs de acesso.

Há limites persistentes por IP e e-mail, compartilhados entre réplicas. O proxy
de entrada deve sobrescrever `x-forwarded-for`, sem confiar no valor do cliente.
Solicitações retornam a mesma confirmação para contas existentes e inexistentes.
Falhas de envio geram somente um aviso técnico sem endereço, link ou segredo.

## Banco e validação

A migração `20261024210000_recuperacao_e_google` é aditiva. O entrypoint executa
`prisma migrate deploy` antes de subir a aplicação. Faça backup antes do deploy.

```bash
npm run check
npm run build
# Apenas contra banco dedicado local com nome contendo _test:
npx tsx --import ./scripts/ambiente-de-teste.ts --test src/core/auth/fluxos.integracao.ts
```

OAuth real e entrega de e-mail precisam de um ensaio com credenciais configuradas.
Os testes automatizados usam um provedor de e-mail simulado, sem enviar mensagens.

Referências: [Google no Auth.js](https://authjs.dev/getting-started/providers/google)
e [recuperação de senha na OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

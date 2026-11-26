# DEPLOY.md — Eagles App (Firebase Hosting + API na VPS)

```
Navegador / PWA / APK ──HTTPS──▶ Firebase Hosting   (SPA estático: build/)
        │
        └──────────HTTPS──▶ Easypanel (Traefik + Let's Encrypt) na VPS 164.152.195.199
                                 └──▶ api:3000  (adapter-node: build-api/)
                                        └──▶ db:5432 (Postgres 16, só na rede interna)
```

- **Frontend**: Firebase Hosting, já publicado em `https://eagles-app-pg.web.app` (também `https://eagles-app-pg.firebaseapp.com`, projeto `eagles-app-pg`).
- **API**: serviço Compose no Easypanel (`docker-compose.yml` na raiz), em `https://api.164-152-195-199.sslip.io`.
  O sslip.io é um DNS gratuito que resolve esse nome para o IP da VPS, e o proxy reverso (Caddy ou Traefik do Easypanel) emite o certificado HTTPS. Não precisa comprar domínio (ver §6 para trocar).
- **Autenticação**: JWT no header `Authorization`, sempre conferido contra a
  sessão no banco (sair e desconectar aparelhos valem na hora).

> A pasta `infra/` (Caddy + app SSR completo) é da arquitetura antiga do M01 e
> **não é usada** neste deploy. O que vale é `docker-compose.yml` na raiz + `deploy/`.

---

## Como prosseguir agora (estado atual da produção)

**Já concluído:**

- Projeto Firebase `eagles-app-pg` criado, `.firebaserc` atualizado e frontend publicado em `https://eagles-app-pg.web.app` (headers de cache e segurança conferidos).
- Serviço Compose no Easypanel apontando para `docker-compose.yml` na raiz, lendo o `.env` da aba Ambiente, com build de `backup` e `npm ci` da `api` passando.

**Falta fazer na VPS (`164.152.195.199`) para fechar o ar:**

1. **Conferir o Caddy (que já serve o `nexus-itam` nas portas 80/443) e os containers:**

   ```bash
   cat /etc/caddy/Caddyfile
   docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
   ```

   _(Não pare nem remova o Caddy — ele mantém o `nexus-itam` no ar.)_

2. **Apontar `api.164-152-195-199.sslip.io` no `Caddyfile`** (o próprio Caddy emite o certificado Let's Encrypt):
   - **Caso A — o Caddy já encaminha para o Easypanel/Traefik ou compartilha a rede Docker:** adicione um bloco seguindo o mesmo padrão do `nexus-itam` apontando para o serviço `api:3000` (ou para o upstream do Easypanel com o header `Host` preservado).
   - **Caso B — o Caddy roda no host e faz `reverse_proxy 127.0.0.1:<porta>`:** verifique uma porta livre em localhost (`ss -tlnp`), exponha `ports: ["127.0.0.1:3001:3000"]` (apenas `127.0.0.1`, nunca pública) no serviço `api` do `docker-compose.yml`, reimplante no Easypanel e adicione ao `Caddyfile`:
     ```caddyfile
     api.164-152-195-199.sslip.io {
         reverse_proxy 127.0.0.1:3001
     }
     ```
   - Recarregue o Caddy sem derrubar o `nexus-itam`:
     ```bash
     sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
     ```
     _(Se o Caddy estiver em container Docker, rode `docker exec <container-caddy> caddy reload --config /etc/caddy/Caddyfile`.)_

3. **Confirmar que a API responde em HTTPS com CORS liberado:**

   ```bash
   curl -i -H "Origin: https://eagles-app-pg.web.app" https://api.164-152-195-199.sslip.io/api/health
   # Esperado: HTTP/2 200, Access-Control-Allow-Origin: https://eagles-app-pg.web.app
   # Corpo: {"status":"ok","banco":true,"latenciaMs":...}
   ```

4. **Criar o primeiro acesso Master (uma vez só)** no console do container `api` no Easypanel (ou via `docker exec`):

   ```bash
   node tools/primeiro-master.mjs --nome "Seu Nome" --email delciofarias04@gmail.com
   ```

   Abra o link impresso, defina sua senha, entre em `https://eagles-app-pg.web.app`, cadastre os 2 líderes em **Pessoas** (`/pessoas`), nomeie-os em **Liderança** (`/lideranca`) e envie os convites pelo WhatsApp.

5. **Publicar atualizações do frontend e conferir backups:**
   - Após puxar o Ciclo 3 (M04 Grupos e transferências), reimplante o serviço Compose no Easypanel (para aplicar a migração `0010_grupos_transferencia.sql`) e rode localmente:
     ```bash
     npm run deploy:firebase
     ```
   - Após ~5 minutos do deploy da VPS, confira nos logs do container `backup` as mensagens `restauração conferida` e `backup concluído`.

---

A ordem abaixo importa: o ID do projeto Firebase entra na configuração da API (CORS).

---

## 0. Criar o projeto no Firebase

1. Em <https://console.firebase.google.com>, **Adicionar projeto** (o plano gratuito Spark basta para Hosting).
2. Anote o **ID do projeto** (ex.: `eagles-app-1a2b3`). O site vai ficar em
   `https://<ID>.web.app` e também em `https://<ID>.firebaseapp.com`.
3. No repositório, troque `TROQUE-PELO-ID-DO-PROJETO` pelo ID em [`.firebaserc`](.firebaserc).

---

## 1. Pré-requisitos na VPS

- Easypanel instalado (ele ocupa as portas 80, 443 e 3000).
- Oracle Cloud → Security List: ingress **TCP 80 e 443** de `0.0.0.0/0`
  (o Let's Encrypt precisa da 80 para emitir o certificado).
- A porta **3001 pode ser fechada**: a API não fica mais exposta em HTTP.
- Conferir o DNS: `nslookup api.164-152-195-199.sslip.io` deve responder `164.152.195.199`.

---

## 2. API no Easypanel

### 2.1 Criar o serviço

1. Easypanel → **Create project** (ex.: `eagles`) → **+ Service** → **Compose**.
2. **Source**: GitHub, repositório `DelcioFDNeto/EaglesApp`, branch `main`.
   Se o repositório for privado, conecte a conta GitHub no Easypanel (Settings → GitHub).
3. **Compose file**: `docker-compose.yml` (na raiz, para que o Docker Compose leia o `.env` gravado pelo Easypanel).

O compose não tem `ports:` nem `container_name:`, como o Easypanel recomenda: o
tráfego entra só pelo domínio, em HTTPS.

### 2.2 Variáveis (aba Environment)

Cole o conteúdo de [`deploy/.env.example`](deploy/.env.example) e preencha:

| Variável                                                   | Valor                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                        | `openssl rand -hex 24`                                               |
| `JWT_SECRET`                                               | `openssl rand -hex 32` (**obrigatória**, mínimo 32 caracteres)       |
| `FRONTEND_URL`                                             | `https://<ID>.web.app`                                               |
| `CORS_ORIGINS`                                             | `https://<ID>.firebaseapp.com,https://localhost` (o segundo é o APK) |
| `PUBLIC_API_URL`                                           | `https://api.164-152-195-199.sslip.io`                               |
| `SMTP_USER` / `SMTP_PASS`                                  | conta e **senha de app** do Gmail (para "esqueci minha senha")       |
| `WHATSAPP_CONSELHEIRO`                                     | só dígitos, ex. `5591999999999` (vazio = sem link)                   |
| `BACKUP_SENHA`                                             | `openssl rand -base64 24` (**obrigatória**; guarde fora da VPS)      |
| `BACKUP_B2_CONTA` / `BACKUP_B2_CHAVE` / `BACKUP_B2_BUCKET` | cópia externa do backup — ver §7                                     |

Sem `JWT_SECRET`, `POSTGRES_PASSWORD`, `FRONTEND_URL`, `PUBLIC_API_URL` ou
`BACKUP_SENHA`, o compose se recusa a subir e diz qual falta.

> Se gerar as senhas no Windows sem `openssl`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### 2.3 Domínio (aba Domains)

- **Host**: `api.164-152-195-199.sslip.io`
- **HTTPS**: ligado
- **Service**: `api` — **Port**: `3000`

### 2.4 Deploy e verificação

Clique em **Deploy**. Nos logs do serviço `api` devem aparecer, em ordem:

```
Executando migrações...
Migrações aplicadas.
Iniciando API...
Listening on http://0.0.0.0:3000
```

Se as migrações falharem, a API **não sobe** (de propósito: código novo contra
schema velho corrompe dados). O log mostra o erro.

Do seu computador:

```bash
curl https://api.164-152-195-199.sslip.io/api/health
# {"status":"ok","banco":true,"latenciaMs":...}
```

### 2.5 Primeiro acesso: o Master (uma vez só)

O banco sobe vazio: sem equipe, papéis nem pessoas. O primeiro acesso é o
**Master** — o desenvolvedor: acima dos líderes e invisível para a equipe. No
Easypanel, abra o **console do container `api`** e rode:

```bash
node tools/primeiro-master.mjs --nome "Seu Nome" --email voce@exemplo.com
```

Ele cria a equipe, as permissões, os papéis e as funcionalidades (todas
desligadas), cria o Master e imprime um **link de convite** de uso único. Abra
o link, escolha a senha e entre com o e-mail.

- Rodar de novo antes do aceite só renova o link.
- Com um Master já ativo, o script se recusa (use `--forcar` só se você
  perdeu o acesso).

Sem console no painel, pela SSH da VPS:
`docker exec -it $(docker ps -qf name=api) node tools/primeiro-master.mjs --nome "..." --email ...`

### 2.6 Os 2 líderes

Logo depois de entrar, o Master:

1. cadastra os 2 líderes em **Pessoas e convites** (`/pessoas`);
2. nomeia cada um em **Liderança** (`/lideranca`), escolhendo a **data de
   início** do mandato (padrão: hoje). Se os líderes atuais já estão no meio
   do mandato, use a data em que ele começou: o ciclo de 2 anos fica certo;
3. manda o convite de cada um pelo WhatsApp (em Pessoas).

Regras da liderança, garantidas no servidor e no banco:

| Regra               | Como funciona                                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| No máximo 2 líderes | A terceira nomeação é recusada (o banco também barra)                                                                  |
| Mandato de 2 anos   | A renovação abre 90 dias antes do fim e emenda mais 2 anos                                                             |
| Data de início      | Escolhida na nomeação e na troca: no passado (sem nascer vencido) ou até 90 dias à frente. O acesso começa na nomeação |
| Mandato vencido     | **Continua valendo**, com aviso no Início, até alguém renovar ou indicar quem assume                                   |
| Quem renova         | Cada líder o próprio mandato; o Master, qualquer um                                                                    |
| Quem troca          | O líder passa a própria liderança a qualquer momento; o do outro, só depois que venceu; o Master, sempre               |
| Último líder        | Não sai sem indicar sucessor (o Master pode encerrar mesmo assim)                                                      |
| Nível máximo        | Ninguém além de líderes e Master gerencia papéis; só o Master altera o papel de líder                                  |

### 2.7 Daí em diante: convites pelo app

Líderes (e os conselheiros, no próprio PG) cadastram e convidam pessoas em
**Início → Pessoas e convites** (`/pessoas`):

1. **Cadastrar pessoa**: só o nome é obrigatório; o telefone com DDD vira o
   login dela e o destino do convite.
2. **Convidar**: gera o link de uso único (7 dias) e abre o WhatsApp já na
   conversa da pessoa, com a mensagem pronta. Sem telefone cadastrado, a
   tela pede na hora.
3. A pessoa abre o link, vê com que telefone/e-mail vai entrar, cria a senha e
   já entra. **Reenviar convite** invalida o link anterior.

Quem já tem acesso não recebe convite: se esqueceu a senha, usa
"Esqueci minha senha" (precisa de e-mail cadastrado).

---

## 3. Frontend no Firebase Hosting

O endereço da API vai **dentro do build**, vindo de [`.env.production`](.env.production)
(versionado; só tem a URL pública). O build se recusa a sair sem uma URL `https://`.

```bash
# Uma vez: login na conta Google do projeto
npx firebase-tools login

# Build + deploy (usa .firebaserc e firebase.json)
npm run deploy:firebase
```

O [`firebase.json`](firebase.json) já configura:

- SPA: toda rota cai no `index.html`;
- cache de 1 ano para `/_app/immutable/**` (o nome muda a cada build);
- `no-cache` no resto, e `no-store` no `service-worker.js`, para que o app
  atualize no aparelho das pessoas logo após o deploy;
- cabeçalhos de segurança (HSTS, `X-Frame-Options`, `frame-ancestors`, etc.).

Confira depois do primeiro deploy (o Firebase não documenta a precedência
entre regras de cabeçalho; o esperado é a específica vencer):

```bash
curl -sI https://<ID>.web.app/ | grep -i cache-control                # no-cache
curl -sI https://<ID>.web.app/service-worker.js | grep -i cache-control  # no-cache, no-store...
curl -sI https://<ID>.web.app/_app/version.json | grep -i cache-control # no-cache
```

---

## 4. Teste de ponta a ponta

1. Abra `https://<ID>.web.app` → deve ir para **Entrar**.
2. Abra o link de convite do §2.5 → defina a senha → cai no **Início** como líder.
3. Saia e entre de novo com o e-mail e a senha.
4. **Esqueci minha senha** → o e-mail deve chegar com link para `https://<ID>.web.app/resetar-senha?token=...`.
5. No DevTools (aba Console), nenhum erro de CORS nem de CSP.

Se aparecer erro de CORS: a origem do site não está em `FRONTEND_URL`/`CORS_ORIGINS`.
Corrija no Easypanel e faça **Deploy** de novo (a lista é lida na subida).

---

## 5. Atualizações

- **API**: push na `main` → Easypanel → **Deploy** (ou ative o deploy
  automático no serviço). As migrações novas rodam sozinhas na subida.
- **Frontend**: `npm run deploy:firebase`.
- **Os dois juntos** quando a mudança mexe no contrato da API: suba a API
  primeiro, depois o frontend.

Antes de qualquer deploy: `npm run check && npm test && npm run build && npm run build:api`
(é o que o CI roda).

---

## 6. Trocar o sslip.io por um domínio próprio

O sslip.io depende de um serviço de terceiros e não tem garantia. Com um
domínio (ex.: `api.eagles.com.br` apontando para `164.152.195.199`), troque em
três lugares e faça deploy dos dois lados:

1. Easypanel → Domains do serviço;
2. Easypanel → Environment → `PUBLIC_API_URL`;
3. `.env.production` → `PUBLIC_API_URL` → `npm run deploy:firebase`.

---

## 7. Backup do banco

O serviço `backup` do compose roda **5 minutos depois de subir** e depois
**todo dia às 3h** (Brasília). Em cada execução:

1. faz o dump do banco;
2. **restaura o dump num banco descartável** e confere tabelas, pessoas e
   migrações — dump que não restaura é descartado e a execução falha;
3. criptografa com AES-256 (`BACKUP_SENHA`) e confere que decifra;
4. envia para fora da VPS e confere que a cópia chegou inteira;
5. mantém os 7 últimos na VPS e 90 dias no remoto.

O serviço fica **unhealthy** no Easypanel se passar 26 h sem um backup completo.
O motivo da última falha fica em `/backups/ultimo-erro.txt`.

### 7.1 Configurar a cópia externa (Backblaze B2, 10 GB grátis)

1. Crie uma conta em <https://www.backblaze.com/cloud-storage> e um **bucket
   privado** (ex.: `eagles-backup-<algo-unico>`).
2. Em **Application Keys**, crie uma chave com acesso **só a esse bucket**.
3. No Easypanel: `BACKUP_B2_CONTA` = keyID, `BACKUP_B2_CHAVE` = applicationKey,
   `BACKUP_B2_BUCKET` = nome do bucket. Deploy.
4. Depois de 5 minutos, nos logs do serviço `backup` deve aparecer
   `restauração conferida`, `cópia externa conferida` e `backup concluído`.

Outro provedor (Cloudflare R2, Google Drive…): configure o `rclone` no seu
computador e use `BACKUP_RCLONE_CONF` (o `rclone.conf` em base64) e
`BACKUP_DESTINO` (ex.: `meuremoto:pasta/eagles`).

**Guarde a `BACKUP_SENHA` num gerenciador de senhas, fora da VPS.** Sem ela,
nenhum backup abre — nem para você.

### 7.2 Restaurar

No console do container `backup`:

```bash
restaurar.sh listar                                   # backups locais e remotos
restaurar.sh eagles_2026-11-26_0300.dump.gpg          # num banco NOVO, para conferir
```

A restauração padrão vai para `eagles_restaurado`, sem tocar no banco da API.
Em caso de desastre, **pare o serviço `api`** e substitua o banco:

```bash
restaurar.sh eagles_2026-11-26_0300.dump.gpg eagles --substituir
```

Se a VPS inteira se perdeu: suba a stack numa VPS nova com as mesmas variáveis
(inclusive `BACKUP_SENHA` e as do B2), e rode o `restaurar.sh` acima — o
arquivo é baixado do remoto.

---

## 8. Mobile (APK Android e PWA)

O mesmo `build/` serve às três frentes:

| Plataforma         | Entrega                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| PWA (iOS, desktop) | O próprio site do Firebase. No iPhone: Safari → Compartilhar → Adicionar à Tela de Início |
| APK Android        | Capacitor embrulha o `build/` num WebView (`capacitor.config.ts`)                         |

O APK chama a mesma API em HTTPS; a origem dele é `https://localhost`, por
isso ela está em `CORS_ORIGINS`.

```bash
npm run build
npx cap add android      # uma vez
npx cap sync android
npx cap open android     # Android Studio → Build → Build APK(s)
```

O APK `debug` é para instalar em aparelhos próprios; para distribuir, gere um `release` assinado.

---

## 9. Cache local (IndexedDB)

`perfil`, `sessoes` e `inicio` ficam em cache no aparelho (5 min) para
funcionar em rede fraca, e sincronizam quando a conexão volta. O cache é limpo
no logout. Código em `src/lib/cache/`.

---

## 10. Segurança

- Segredos só no Easypanel, nunca no repositório. `.env.production` é público por natureza.
- Trocar `JWT_SECRET` desconecta todo mundo (todos os tokens deixam de valer).
- O Postgres não tem porta publicada: só a API o alcança.
- Atrás do Traefik, a API usa o IP real do cliente (`X-Forwarded-For`,
  `XFF_DEPTH=1`) para o limite de tentativas. Se um dia houver outro proxy na
  frente (ex.: Cloudflare), aumente `XFF_DEPTH` para 2.
- Links de redefinição de senha valem 15 minutos, são de uso único e o banco guarda só o hash.
- Sessão e token valem 30 dias. Senha errada 5 vezes bloqueia a conta por 15 min,
  depois 30 min, 1 h… (até 24 h) — gravado no banco. Login, logout, falhas e
  bloqueios ficam na auditoria.
- A API limpa sozinha sessões e links antigos (a cada 6 h) e a memória do
  limite de tentativas (a cada 10 min).

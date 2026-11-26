# DEPLOY.md — Eagles App (Opção B: Firebase Hosting + API na VPS)

Arquitetura separada:
- **Frontend estático**: Firebase Hosting (`seuapp.web.app`, HTTPS grátis)
- **Backend API**: VPS Oracle Cloud (IP `164.152.195.199`, Ubuntu, Docker)
- **Banco**: PostgreSQL 16 no mesmo VPS (Docker)
- **Autenticação**: JWT (não há sessão server-side no frontend)

---

## Pré-requisitos na VPS

- Ubuntu com Docker e Docker Compose já instalados
- IP público: `164.152.195.199`
- Porta 3001 aberta no firewall da Oracle Cloud (Security List → ingress TCP 3001 de `0.0.0.0/0`)
  *(a porta 3000 é usada pelo Easypanel; o container expõe 3000 internamente, mapeado para 3001 fora)*

---

## 1. Variáveis de ambiente na VPS

Copie o exemplo e preencha os valores reais:

```bash
cd EaglesApp
cp deploy/.env.example .env
nano .env
```

Campos obrigatórios:

| Variável | Exemplo | Observação |
|---|---|---|
| `POSTGRES_PASSWORD` | `senha_forte` | Senha do banco |
| `JWT_SECRET` | `openssl rand -hex 32` | **Obrigatória**, mínimo 32 caracteres. Sem ela o compose não sobe e a API recusa emitir/aceitar tokens |
| `FRONTEND_URL` | `https://seuapp.web.app` | URL do Firebase Hosting. Libera o CORS e monta os links de convite e de redefinição de senha |
| `PUBLIC_API_URL` | `http://164.152.195.199:3001` | API da VPS (ou túnel HTTPS) |
| `SMTP_USER` | `seu@gmail.com` | Para envio de "esqueci senha" |
| `SMTP_PASS` | `senha_de_app` | Senha de app do Gmail (não a senha normal) |
| `WHATSAPP_CONSELHEIRO` | `5511999999999` | Número para link de WhatsApp |

Alternativa ao SMTP: descomente `RESEND_API_KEY` no `.env` e use a opção Resend em `src/lib/server/auth/email.ts`.

---

## 2. Subir os containers na VPS

```bash
# Na VPS, dentro da pasta EaglesApp
docker compose -f deploy/docker-compose.yml up -d --build

# Acompanhar logs
docker compose -f deploy/docker-compose.yml logs -f

# Verificar se a API responde
curl http://164.152.195.199:3001/api/health
```

A imagem é construída com `adapter-node` (`BUILD_TARGET=api`, saída em `build-api/`), em Node 22. O `entrypoint.sh` aplica as migrações do Drizzle antes de iniciar a API, com até 5 tentativas. Se as migrações falharem, a API **não sobe**: rodar código novo contra um schema antigo corromperia dados.

Para gerar o mesmo build localmente: `npm run build:api` (o `npm run build` continua gerando o SPA estático para o Firebase/Capacitor).

---

## 3. Firebase Hosting (frontend)

No diretório do frontend (ou na raiz do projeto, se quiser manter junto):

```bash
# Instalar Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Inicializar Hosting (escolha a pasta de build, ex: .svelte-kit/output ou build)
firebase init hosting

# Build do frontend
npm run build  # ou o comando específico de build estático

# Deploy
firebase deploy
```

O Firebase gera um endereço tipo `https://seuapp.web.app` com HTTPS automático.

> Atenção: o frontend no Firebase precisa da variável `PUBLIC_API_URL` apontando para a VPS. Se a VPS for apenas HTTP (`http://164.152.195.199:3001`), navegadores podem bloquear mixed content (HTTPS → HTTP). Soluções:
> 1. Colocar a VPS atrás de **Cloudflare Tunnel** (grátis, sem domínio): `cloudflared tunnel --url http://localhost:3000`
> 2. Usar HTTP apenas em ambiente de teste local.

---

## 4. Arquivos criados nesta etapa

| Arquivo | Função |
|---|---|
| `src/lib/server/auth/jwt.ts` | Geração e validação de JWT |
| `src/lib/server/auth/email.ts` | Envio de e-mail (Nodemailer SMTP; opção Resend comentada) |
| `src/lib/server/auth/middleware.ts` | Middleware `autenticar()` para rotas protegidas |
| `src/lib/api.ts` | Camada `fetch` do frontend com JWT |
| `src/routes/api/auth/login/+server.ts` | POST login (retorna JWT) |
| `src/routes/api/auth/me/+server.ts` | GET dados da pessoa autenticada |
| `src/routes/api/auth/logout/+server.ts` | POST logout (auditoria) |
| `src/routes/api/auth/esqueci-senha/+server.ts` | POST gera token de reset e envia e-mail |
| `src/routes/api/auth/resetar-senha/+server.ts` | POST redefine senha com token |
| `src/routes/api/auth/solicitar-cadastro/+server.ts` | POST solicita acesso (cadastro pendente) |
| `src/routes/esqueci-senha/+page.svelte` | Tela frontend: esqueci minha senha |
| `src/routes/resetar-senha/+page.svelte` | Tela frontend: redefinir senha (com token) |
| `src/routes/solicitar-cadastro/+page.svelte` | Tela frontend: solicitar acesso |
| `src/routes/entrar/+page.svelte` | Atualizado: usa `apiFetch` + JWT |
| `src/hooks.server.ts` | Adicionado CORS para Firebase |
| `src/lib/server/db/schema/index.ts` | Tabelas `senha_reset` e `cadastro_pendente` |
| `deploy/docker-compose.yml` | Orquestração API + Postgres |
| `deploy/Dockerfile` | Imagem da API |
| `deploy/entrypoint.sh` | Espera banco, roda migrações, inicia API |
| `deploy/.env.example` | Exemplo de variáveis de ambiente |
| `DEPLOY.md` | Este arquivo |

---

## 5. Tabelas novas no banco

Adicionadas ao schema Drizzle:

- **`senha_reset`**: tokens de redefinição de senha (15 min, uso único)
- **`cadastro_pendente`**: solicitações de acesso aguardando convite do conselheiro

As migrações rodam automaticamente no `entrypoint.sh`. Se precisar gerar manualmente:

```bash
npm run db:generate
npm run db:migrate
```

---

## 6. Fluxos de autenticação

### Login
1. Frontend chama `POST /api/auth/login` com `{ identificador, senha }`
2. Backend retorna `{ token, pessoa }`
3. Frontend grava `localStorage.setItem('eagles_token', token)`
4. Rotas protegidas enviam `Authorization: Bearer <token>`

### Esqueci minha senha
1. Usuário preenche e-mail em `/esqueci-senha`
2. Backend gera token, salva em `senha_reset`, envia e-mail com link para `/resetar-senha?token=...`
3. Usuário clica no link (no Firebase), digita nova senha
4. Backend valida token, atualiza senha, invalida token

### Solicitação de cadastro
1. Usuário preenche nome, e-mail, telefone em `/solicitar-cadastro`
2. Backend salva em `cadastro_pendente`
3. Backend retorna link do WhatsApp para o conselheiro
4. Conselheiro gera convite de uso único (`/convite/[token]`) e envia ao usuário

---

## 7. Próximos passos para o próximo agente

1. **Validar build local**: `npm run check`, `npm test`, `npm run build` e `npm run build:api`
2. **Ajustar mixed content**: configurar Cloudflare Tunnel ou domínio na VPS para HTTPS
3. **Configurar Firebase Hosting** e fazer o primeiro deploy
4. **Testar fluxo completo** no navegador: login → início → esqueci senha → solicitação de cadastro

---

## 8. Segurança

- Não commite `.env` com senhas reais
- `JWT_SECRET` deve ser forte (`openssl rand -hex 32`)
- O banco PostgreSQL está exposto apenas internamente na rede Docker (não exposto para fora da VPS)
- Tokens de reset expiram em 15 minutos e são de uso único
- O endpoint de login não revela se o e-mail existe

---

## 8. Cache local (IndexedDB) para especialidades críticas

O app armazena em cache local (IndexedDB) os dados das seguintes especialidades
para funcionar offline ou em rede fraca:

| Especialidade | Endpoint da API | TTL padrão | Uso |
|---|---|---|---|
| `perfil` | `GET /api/auth/me` | 5 min | Dados da pessoa logada |
| `sessoes` | `GET /api/sessoes` | 5 min | Dispositivos conectados |
| `inicio` | `GET /api/inicio` | 5 min | Dados da tela de início |

### Como funciona

1. **Com conexão**: o frontend busca na API da VPS, salva no IndexedDB e retorna os dados.
2. **Sem conexão**: o frontend retorna os dados do cache local (se existirem e não expiraram).
3. **Conexão volta**: dispara sincronização automática de todas as especialidades em segundo plano.

### Arquivos

| Arquivo | Função |
|---|---|
| `src/lib/cache/indexeddb.ts` | Camada de IndexedDB (salvar, ler, remover, limpar com TTL) |
| `src/lib/cache/sync.ts` | Sincronização offline/online + `buscarComCache()` |
| `src/lib/api.ts` | `apiCache.perfil()`, `apiCache.sessoes()`, `apiCache.inicio()` |
| `src/lib/ui/IndicadorConexao.svelte` | Indicador visual de offline / sincronizando |
| `src/routes/+layout.svelte` | Inclui o indicador de conexão em todas as telas |

### Limpar cache

O cache é limpo automaticamente no logout (`localStorage.removeItem('eagles_token')`)
ou pode ser limpo manualmente via `limparCacheLocal()` de `$lib/cache/sync`.

---

## 9. Mobile (APK Android + PWA iOS/Desktop)

O Eagles App agora roda em três frentes a partir da mesma base de código:

| Plataforma | Como é entregue | Requisito |
|---|---|---|
| **PWA (Firebase Hosting)** | Build estático hospedado no Firebase (`.web.app`) | HTTPS automático, manifest + service worker |
| **PWA (Notebook/Desktop)** | Mesmo build estático, instalável via Chrome/Edge | `manifest.webmanifest`, `theme-color`, service worker |
| **APK Android** | Capacitor embrulha o build estático em WebView nativo | Android Studio, `capacitor.config.ts`, `build/` |

### 9.1. Firebase Hosting (PWA — iOS e Desktop)

O `svelte.config.js` já usa `adapter-static`, que gera uma pasta `build/` pronta para o Firebase Hosting.

```bash
# Instalar Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Inicializar Hosting (na raiz do projeto)
firebase init hosting
#   - Selecione o projeto Firebase
#   - Pasta pública: build
#   - Configure como app de página única (SPA): sim
#   - Não sobrescreva o index.html (se perguntar)

# Build do frontend
npm run build

# Deploy para o Firebase
firebase deploy
```

O app fica disponível em `https://seuapp.web.app` com HTTPS automático — obrigatório para PWA.

No iPhone/iPad, o usuário abre o Safari, toca em **Compartilhar → Adicionar à Tela de Início**.  
No desktop (Chrome/Edge), aparece o ícone de instalação na barra de endereços.

### 9.2. APK Android (Capacitor — instalação direta, sem Play Store)

O Capacitor embrulha o build estático do SvelteKit num WebView nativo Android.

```bash
# 1. Instalar dependências do Capacitor
npm install

# 2. Inicializar o Capacitor (executar apenas uma vez)
npx cap init

# 3. Adicionar plataforma Android
npx cap add android

# 4. Gerar o build estático do SvelteKit
npm run build

# 5. Copiar o build para o projeto Android nativo
npx cap copy

# 6. Sincronizar plugins e dependências
npx cap sync android

# 7. Abrir no Android Studio para gerar o APK
npx cap open android
```

No Android Studio:
- **Build → Build Bundle(s) / APK(s) → Build APK(s)**
- O APK fica em `android/app/build/outputs/apk/debug/app-debug.apk`
- Para instalar em um dispositivo: `adb install android/app/build/outputs/apk/debug/app-debug.apk`

> O APK gerado em `debug` é para instalação direta (sideload) em dispositivos próprios.  
> Para distribuição ampla, gere um APK `release` assinado no Android Studio.

### 9.3. Variáveis de ambiente para mobile

No `capacitor.config.ts`, o `webDir` aponta para `build/` (saída do `adapter-static`).  
A API da VPS é chamada via `PUBLIC_API_URL` definida no `.env` da VPS.  
No APK, o WebView carrega o HTML local, então as chamadas `fetch` vão diretamente para o IP da VPS (`http://164.152.195.199:3001`).

### 9.4. Checklist de build

| Passo | Comando | Onde rodar |
|---|---|---|
| Instalar Capacitor | `npm install` | Raiz do projeto |
| Inicializar Capacitor | `npx cap init` | Raiz do projeto (1×) |
| Adicionar Android | `npx cap add android` | Raiz do projeto (1×) |
| Build web | `npm run build` | Raiz do projeto |
| Copiar para Android | `npx cap copy` | Raiz do projeto |
| Sync plugins | `npx cap sync android` | Raiz do projeto |
| Abrir Android Studio | `npx cap open android` | Raiz do projeto |
| Gerar APK | Build → Build APK(s) | Android Studio |
| Deploy Firebase | `firebase deploy` | Raiz do projeto |

---

## 10. Próximos passos para o próximo agente

1. **Validar build local**: `npm run check`, `npm test`, `npm run build`
2. **Ajustar mixed content**: configurar Cloudflare Tunnel ou domínio na VPS para HTTPS
3. **Migrar rotas restantes** (`/inicio`, `/conta/sessoes`, `/convite/[token]`, `/sair`) para consumir a API via `apiFetch` em vez de server actions
4. **Configurar Firebase Hosting** e fazer o primeiro deploy
5. **Inicializar Capacitor** e gerar o primeiro APK de teste
6. **Testar fluxo completo** no navegador: login → início → esqueci senha → solicitação de cadastro
7. **Testar o APK** em dispositivo Android real

---

## 11. Segurança

- Não commite `.env` com senhas reais
- `JWT_SECRET` deve ser forte (`openssl rand -hex 32`)
- O banco PostgreSQL está exposto apenas internamente na rede Docker (não exposto para fora da VPS)
- Tokens de reset expiram em 15 minutos e são de uso único
- O endpoint de login não revela se o e-mail existe
- O APK `debug` é para instalação direta; para distribuição ampla, gere um APK `release` assinado

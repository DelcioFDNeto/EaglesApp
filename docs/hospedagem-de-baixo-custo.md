# Hospedagem de baixo custo — dá para rodar de graça?

- **Data:** 11/10/2026 — preços e cotas gratuitas mudam com frequência; confira antes de contratar
- **Responde a:** D-06 (domínio) e D-07.2 (máquina), pendentes no documento de arquitetura
- **Resposta curta:** **sim, dá para rodar por R$ 0/mês.** A recomendação, porém, é gastar **R$ 40 por ano** no domínio — o único item caro de trocar depois.

---

## 1. O que o app precisa — medido, não estimado

Na varredura de 11/10/2026 a pilha de produção rodou inteira (ver `infra/README.md`):

| Peça                     | Memória em repouso |
| ------------------------ | ------------------ |
| App (SvelteKit, Node)    | ~50 MB             |
| PostgreSQL               | ~42 MB             |
| Caddy (HTTPS automático) | ~15 MB             |
| **Total**                | **~105 MB**        |

Cada login usa ~19 MB a mais por alguns centésimos de segundo (o hash da senha). Para algumas centenas de pessoas, **uma VM de 1 GB sobra**. O app não envia e-mail (o acesso é por convite no WhatsApp, D-04), então não há serviço de e-mail a pagar.

O que o app **exige** da hospedagem:

1. **Um processo sempre ligado.** O limite de tentativas de login vive na memória do processo, e quem abre o link do evento no WhatsApp não pode esperar o servidor "acordar".
2. **PostgreSQL de verdade**, com gatilhos e transações — boa parte das regras de segurança mora no banco.
3. **Disco persistente** para o banco e os backups.
4. **HTTPS** — sem ele não há app instalado no celular (PWA) nem notificações.

---

## 2. Onde rodar

| Opção                                          | Custo/mês   | Serve? | Por quê                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **VPS que a liderança já tem** (D-07.2)        | R$ 0 a mais | ✅     | Era o plano original. Se a VPS existe, esta é a melhor opção                                                                                                                                                                                                                                                                                                 |
| **Google Cloud — e2-micro "Always Free"**      | R$ 0        | ✅     | 1 GB de RAM e 30 GB de disco, sempre ligada, sem regra de "máquina ociosa". Pede cartão. Só nas regiões dos EUA — algo como um décimo de segundo a mais por toque, aceitável para este uso. A cota de saída de dados (1 GB/mês) sobra para páginas de poucas dezenas de KB                                                                                   |
| **Oracle Cloud — Always Free**                 | R$ 0        | ⚠️     | Bem mais máquina (ARM, 2 OCPU/12 GB desde agosto de 2026 — a Oracle **cortou pela metade** sem aviso) e tem região em São Paulo. Mas a Oracle **recupera máquinas "ociosas"** (CPU, rede e memória abaixo de 20% por 7 dias) — exatamente o perfil deste app. Só vale convertendo a conta para "Pay As You Go" (pede cartão; continua grátis dentro da cota) |
| **Render (app) + Neon (banco), planos grátis** | R$ 0        | ❌     | O app "dorme" depois de 15 minutos sem uso e leva perto de um minuto para acordar — o link do WhatsApp abriria numa tela de espera. O Postgres grátis do próprio Render expira em 30 dias                                                                                                                                                                    |
| Fly.io, Railway, Koyeb                         | —           | ❌     | Sem plano gratuito permanente em 2026 (Koyeb passou a exigir cartão com bloqueio de US$ 29)                                                                                                                                                                                                                                                                  |

**Recomendação para a máquina:** se a VPS existe, ela. Se não, **Google e2-micro** — menos máquina que a Oracle, mas sem o risco de ser desligada por "ociosidade". A pilha cabe sem ajuste: o `docker-compose.yml` já sobe com uma réplica e com o monitor desligado.

---

## 3. O domínio

| Opção                                                          | Custo         | HTTPS, app instalado e notificações | O porém                                                              |
| -------------------------------------------------------------- | ------------- | ----------------------------------- | -------------------------------------------------------------------- |
| **Subdomínio gratuito** — deSEC (`eagles.dedyn.io`) ou DuckDNS | R$ 0          | ✅ Let's Encrypt funciona           | Ver abaixo                                                           |
| **`.com.br` no Registro.br**                                   | **R$ 40/ano** | ✅                                  | Nenhum relevante — o preço é o mesmo desde 2017, também na renovação |

O subdomínio gratuito funciona tecnicamente. Os poréns são de outra natureza:

1. **Trocar de domínio depois custa caro.** Para o navegador, outro domínio é outro app: todo mundo instala de novo, entra de novo com a senha, e os links já enviados no WhatsApp (convites, `/e/…` dos eventos) só continuam valendo se o domínio antigo ficar redirecionando. **É a única escolha deste deploy difícil de desfazer** — vale fazê-la antes de a comunidade instalar o app.
2. **Confiança.** Um link `eagles.dedyn.io` chegando no WhatsApp parece menos "oficial" do que `eagles.com.br`. E domínios de DNS dinâmico são usados com frequência em golpes; alguns filtros de rede corporativa os bloqueiam.
3. **Dependência de serviço voluntário.** DuckDNS e deSEC são mantidos por voluntários e entidades sem fins lucrativos. Funcionam há anos, mas sem garantia — e o domínio é o endereço de tudo.

**Recomendação para o domínio:** **`.com.br` (R$ 40/ano)**. Se o orçamento for literalmente zero, o deSEC funciona — sabendo que mudar depois significa reinstalar o app em todos os celulares.

---

## 4. O backup fora da máquina

Obrigatório (seção 15): backup que mora só na máquina que pode morrer não é backup. O Backblaze B2 cobra cerca de US$ 7 por TB/mês; o backup cifrado do banco hoje tem dezenas de KB — **centavos por mês**, quando não fica na cota gratuita. O `docker-compose.yml` lê as credenciais de `B2_ACCOUNT_ID` e `B2_APPLICATION_KEY`.

---

## 5. Os cenários

| Cenário                                                     | Custo                                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **100% gratuito** — e2-micro + deSEC + B2                   | **R$ 0/mês**                                                                            |
| **Recomendado** — e2-micro (ou a VPS existente) + `.com.br` | **R$ 40/ano** (~R$ 3,33/mês) + centavos de backup                                       |
| Plano original da arquitetura (VPS existente), sem IA       | ~R$ 6/mês além da VPS (a tabela da seção 15.6 dizia ~R$ 40 por erro de soma, corrigido) |

O que muda no código para qualquer um deles: **nada.** A varredura de 11/10/2026 corrigiu o que impediria o deploy (o Caddy não subia, as migrações não eram aplicadas, a cópia externa do backup falharia) e deixou a pilha leve por padrão.

---

## Fontes consultadas (outubro de 2026)

- Oracle — corte das cotas e regra de ociosidade: [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Oracle Cloud Customer Connect](https://community.oracle.com/customerconnect/discussion/974451/always-free-a1-disabled-need-re-enable-to-resize-4-ocpu-24gb-to-2-ocpu-12gb), [documentação "Always Free Resources"](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm), [klymentiev.com](https://klymentiev.com/blog/free-vps), [51sec.org](https://blog.51sec.org/2023/02/oracle-cloud-cleaning-up-idle-compute.html)
- Planos gratuitos de PaaS: [flaviocopes.com](https://flaviocopes.com/hosting-free-tiers/), [snapdeploy.dev](https://snapdeploy.dev/state-of-free-hosting), [selfhost.dev](https://www.selfhost.dev/blog/best-free-postgresql-hosting/)
- Google e2-micro: guias de 2026 em [wikidocs.net](https://wikidocs.net/blog/@insightbridge/18254/) (confirmar na página oficial do Google Cloud Free Tier)
- Registro.br: [tabela oficial de pagamento](https://registro.br/ajuda/pagamento-de-dominio/)
- Subdomínios gratuitos: [deSEC](https://talk.desec.io/t/how-does-domain-creation-work/834), [Let's Encrypt e dedyn.io](https://community.letsencrypt.org/t/dynamic-dns-provider-desec-io-can-be-used-with-lets-encryt/17931), [DuckDNS](https://oneuptime.com/blog/post/2026-03-20-duckdns-portainer-dynamic-dns/markdown)
- Backblaze B2: [dev.to](https://dev.to/ethan-carter/backblaze-b2-vs-self-hosted-s3-which-saves-more-money-4gp8), [costbench.com](https://costbench.com/software/cloud-infrastructure/backblaze-b2/)

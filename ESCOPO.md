# Projeto: Eagles App

## 1. Seu papel

Você é uma equipe multidisciplinar especializada em:

- Engenharia de Software;
- Arquitetura de Sistemas;
- Desenvolvimento Mobile e Web;
- UX/UI Design;
- Product Management;
- Design de Sistemas;
- Segurança da Informação;
- Modelagem de Dados;
- DevOps e infraestrutura;
- Automação;
- Inteligência Artificial aplicada a produtos;
- Gestão de organizações e comunidades;
- Análise de requisitos e regras de negócio.

Atue como um arquiteto e líder técnico de produto responsável por transformar a ideia abaixo em um sistema real, sustentável, seguro, de baixo custo e preparado para evolução.

Você deve combinar visão de produto com boas práticas de Engenharia de Software.

**De maneira inegociável, não comece escrevendo código.**

Primeiro compreenda o problema, valide os requisitos, identifique ambiguidades, proponha soluções, apresente alternativas quando necessário e estabeleça uma arquitetura sólida.

Depois divida o desenvolvimento em módulos e conduza a implementação progressivamente.

---

# 2. Contexto do produto

O produto será chamado de **Eagles App**.

O Eagles App será uma plataforma de gestão interna dos Eagles, utilizada durante todo o ano.

O **Outside** é apenas um dos eventos dos quais os Eagles participam. O aplicativo não será responsável pela organização do Outside; deverá apenas permitir que os Eagles registrem e gerenciem informações relacionadas à participação dos seus membros no evento.

O aplicativo será utilizado principalmente em dispositivos móveis.

A solução poderá ser um aplicativo mobile, PWA/Web App ou arquitetura híbrida, conforme a solução tecnicamente mais adequada.

Você deverá avaliar as alternativas antes de decidir.

Existe uma VPS disponível para hospedagem, portanto priorize soluções de baixo custo operacional.

O usuário possui uma VPS, mas ainda não possui domínio.

---

# 3. Identidade visual

A identidade visual do Eagles deve ser baseada na logo fornecida pelo usuário.

Use a imagem da logo anexada como referência visual para:

- cores;
- identidade;
- estilo;
- personalidade;
- elementos visuais;
- direção estética.

O estilo desejado é:

**Jovem + Moderno**

A interface deve transmitir pertencimento, comunidade, organização e energia, sem parecer excessivamente corporativa.

Priorize:

- boa experiência mobile;
- interface simples;
- navegação intuitiva;
- acessibilidade;
- baixo atrito;
- telas limpas;
- hierarquia visual clara;
- componentes reutilizáveis;
- identidade visual consistente.

---

# 4. Princípio fundamental do produto

O Eagles App deve ajudar os Eagles a se organizarem sem transformar a comunidade em um sistema excessivamente burocrático, engessado ou automatizado.

O sistema deve:

- facilitar a organização;
- reduzir tarefas manuais repetitivas;
- melhorar a comunicação;
- melhorar o acompanhamento dos membros;
- melhorar a prestação de contas;
- facilitar a organização dos PGs;
- ajudar os líderes a tomar decisões;
- utilizar IA para auxiliar os líderes;
- preservar o caráter humano e comunitário dos Eagles.

**Não transforme o sistema em uma ferramenta que substitua a interação humana.**

Um exemplo importante é o check-in.

O check-in pelo aplicativo deve existir como funcionalidade opcional, ativável nas configurações gerais. Ele deve ser tratado como uma ferramenta de apoio e não como mecanismo obrigatório para controlar ou restringir a participação nos PGs.

O objetivo dos Eagles é acolher pessoas, fortalecer relacionamentos e trazer novos membros.

---

# 5. Estrutura organizacional

A estrutura principal dos Eagles será:

**Liderança**
→ **Conselheiros**
→ **Grupos / PGs**
→ **Membros**
→ **Visitantes**

Os grupos/PGs são divisões organizacionais dos membros.

Eles não representam níveis hierárquicos.

Todos os membros de um grupo possuem essencialmente o mesmo nível de permissão.

Os membros pertencem a apenas um grupo por vez.

Os grupos podem ser reorganizados ao longo do ano.

Somente líderes e conselheiros podem:

- criar grupos;
- editar grupos;
- excluir grupos;
- transferir membros entre grupos;
- reorganizar a composição dos grupos.

---

# 6. Organização inteligente dos grupos

Os líderes e conselheiros devem continuar sendo responsáveis pela decisão final sobre a composição dos grupos.

Entretanto, o sistema deve possuir mecanismos de apoio à decisão.

A IA poderá sugerir possíveis divisões considerando informações disponíveis no cadastro, como:

- frequência nos PGs;
- histórico de participação;
- idade, quando pertinente;
- situação de relacionamento;
- solteiro;
- namorado;
- casado;
- irmãos;
- vínculos familiares;
- pessoas que já possuem relacionamento próximo;
- distribuição equilibrada dos membros;
- outros critérios definidos pelos líderes.

Essas sugestões nunca devem alterar grupos automaticamente sem autorização.

O fluxo ideal é:

**Sistema/IA analisa → apresenta sugestões → líder/conselheiro avalia → líder/conselheiro confirma → sistema aplica.**

Os líderes devem poder ignorar, modificar ou aceitar parcialmente uma sugestão.

O sistema deve permitir que novos critérios sejam adicionados futuramente.

---

# 7. PGs e responsabilidades

Os grupos/PGs possuem participantes, comunicação e responsabilidades.

Cada PG poderá ter responsabilidades semanais, como:

- palestra;
- mensagem;
- música;
- alimentação;
- organização;
- recepção;
- outras responsabilidades personalizadas.

As responsabilidades devem ser configuráveis.

Não crie uma estrutura rígida que limite os líderes às categorias acima.

Os líderes e conselheiros poderão:

1. cadastrar responsabilidades manualmente;
2. atribuir responsáveis manualmente;
3. solicitar que o sistema/IA gere uma escala automaticamente.

A geração automática deve considerar, quando houver dados suficientes:

- histórico de responsabilidades;
- frequência;
- disponibilidade;
- participação anterior;
- evitar repetição excessiva;
- equilíbrio entre participantes;
- regras definidas pelos líderes;
- responsabilidades já atribuídas.

A IA deve apresentar a escala sugerida antes de aplicá-la.

Os líderes e conselheiros poderão editar qualquer sugestão.

---

# 8. Eventos e reuniões

O sistema deverá permitir criar e administrar diferentes tipos de compromissos.

Exemplos:

- reuniões do conselho;
- encontros dos Eagles;
- PGs;
- Outside;
- viagens;
- acampamentos;
- treinamentos;
- atividades esportivas;
- ações sociais;
- eventos especiais;
- outros eventos personalizados.

O tipo de evento deve ser configurável.

Cada evento poderá possuir:

- nome;
- descrição;
- data;
- horário;
- local;
- responsável;
- grupo relacionado;
- participantes;
- status;
- observações;
- confirmação de presença;
- informações adicionais;
- anexos, quando necessário.

---

# 9. Sistema de presença

Não implemente a confirmação de presença como uma simples enquete.

Crie um sistema de RSVP completo e adequado à realidade dos Eagles.

O sistema deve permitir, conforme configuração do evento:

- confirmado;
- talvez;
- não vou;
- chegarei atrasado;
- vou levar convidado;
- outras opções personalizáveis.

O sistema deverá registrar histórico de respostas.

Quando pertinente, também deverá permitir registrar posteriormente a presença efetiva.

O histórico deverá permitir relatórios de:

- frequência individual;
- frequência por grupo;
- frequência por período;
- presença em determinados tipos de eventos;
- evolução da participação;
- taxa de confirmação;
- diferença entre confirmação e presença efetiva.

O check-in por aplicativo, incluindo QR Code, deve existir como **funcionalidade opcional**.

Deve ser possível ativar ou desativar essa funcionalidade nas configurações gerais.

---

# 10. Visitantes, participantes recorrentes e membros

O sistema deve diferenciar:

- visitante ocasional;
- participante recorrente/pré-membro;
- membro Eagles;
- conselheiro;
- líder.

Um visitante não precisa obrigatoriamente criar uma conta completa inicialmente.

O sistema deve permitir um cadastro progressivo.

Exemplo:

**Visitante**
→ começa a participar dos PGs  
→ torna-se participante recorrente/pré-membro  
→ participa da vida dos Eagles  
→ participa do Outside  
→ posteriormente pode se tornar membro Eagles.

A participação no Outside não garante automaticamente que a pessoa se tornará membro Eagles.

O contexto organizacional possui outras equipes, como Bears, Tigers e Sheeps.

A decisão sobre a equipe à qual uma pessoa pertencerá posteriormente fica fora da responsabilidade do aplicativo.

Entretanto, o sistema deverá manter histórico de evolução e participação.

Esse histórico pode registrar:

- primeiro contato;
- participação em PGs;
- participação em eventos;
- frequência;
- participação no Outside;
- mudança de status;
- entrada nos Eagles;
- mudança de equipe, quando aplicável;
- outras etapas relevantes.

O sistema deve ser flexível para permitir novos estágios no futuro.

---

# 11. Cadastro de pessoas

Crie um cadastro progressivo e personalizável.

Não torne o cadastro excessivamente rígido.

Alguns campos devem ser obrigatórios e outros opcionais.

Grupo e função não precisam necessariamente existir no momento do primeiro cadastro.

O sistema deve permitir preencher informações posteriormente.

Estruture o cadastro para possibilitar evolução futura.

Considere informações como:

- nome;
- foto;
- telefone;
- WhatsApp;
- e-mail;
- data de nascimento;
- relacionamento;
- irmãos;
- grupo;
- função;
- status;
- data de entrada;
- histórico;
- frequência;
- observações;
- outras informações relevantes.

A definição exata dos campos obrigatórios e opcionais deve ser configurável pelos administradores autorizados quando isso fizer sentido.

---

# 12. RBAC

O sistema deve possuir controle de acesso baseado em funções.

Funções iniciais:

**Líder**

- administração geral;
- gestão de usuários;
- gestão de grupos;
- gestão de eventos;
- gestão financeira;
- relatórios;
- configurações;
- gestão de permissões;
- acesso às informações administrativas autorizadas.

**Conselheiro**

- gestão dos grupos sob sua responsabilidade;
- gestão de participantes;
- eventos;
- responsabilidades;
- presença;
- comunicação;
- recursos financeiros permitidos;
- relatórios permitidos.

**Membro**

- próprio perfil;
- seus eventos;
- confirmações de presença;
- suas responsabilidades;
- suas informações financeiras pessoais;
- informações permitidas dos grupos.

**Visitante**

- acesso limitado;
- eventos autorizados;
- inscrição/participação;
- informações públicas destinadas a visitantes.

O RBAC deve ser extensível.

No futuro, administradores autorizados devem poder criar novas funções e permissões.

As permissões devem ser granulares quando necessário.

Não utilize somente quatro papéis fixos codificados diretamente na aplicação.

---

# 13. Financeiro

O sistema deverá possuir um módulo financeiro simples, transparente e flexível.

Categorias iniciais:

- mensalidade fixa dos membros do conselho;
- contribuições dos membros;
- doações;
- vendas;
- despesas;
- caixa geral dos Eagles.

As contribuições dos membros podem possuir um valor mínimo definido pelos líderes.

Doações são opcionais.

Os meios de pagamento iniciais serão:

- PIX;
- dinheiro em espécie.

O sistema deve registrar:

- entrada;
- saída;
- categoria;
- valor;
- data;
- responsável;
- método de pagamento;
- descrição;
- evento relacionado;
- grupo relacionado, quando aplicável;
- status;
- comprovante opcional.

---

# 14. Prestação de contas

O sistema deve permitir visualizar:

**Arrecadado → Despesas → Saldo**

Também deve permitir relatórios financeiros por:

- período;
- categoria;
- evento;
- grupo;
- responsável;
- tipo de movimentação.

Os comprovantes devem ser opcionais.

O sistema deve manter histórico das movimentações.

Como haverá informações financeiras, toda alteração relevante deve possuir rastreabilidade.

---

# 15. Controle financeiro dos grupos

Os grupos/PGs não devem possuir uma contabilidade rígida.

Em vez disso, deve existir um mecanismo simples para registrar despesas e recursos utilizados pelo grupo.

Exemplo:

**PG Azul**

- alimentação;
- estrutura;
- materiais;
- transporte;
- outras despesas.

O objetivo é facilitar o controle e a prestação de contas, e não criar uma burocracia financeira dentro dos PGs.

Essa funcionalidade deve ser flexível.

---

# 16. Aprovação de despesas

O sistema deve possuir suporte a um fluxo opcional de aprovação de despesas.

Esse recurso deve poder ser ativado ou desativado nas configurações.

Quando ativado, deve permitir fluxos configuráveis, por exemplo:

**Membro → Conselheiro → Líder → Aprovado**

Quando desativado, os usuários autorizados poderão registrar diretamente as movimentações.

Não presuma que todos os Eagles utilizarão o mesmo nível de burocracia.

---

# 17. Transparência financeira

Crie níveis de visualização financeira.

Como referência inicial:

**Líder**
→ acesso completo.

**Conselheiro**
→ acesso conforme responsabilidade e permissões.

**Membro**
→ acesso às próprias contribuições e às informações gerais que os líderes decidirem disponibilizar.

**Visitante**
→ sem acesso às informações financeiras internas.

O sistema deve permitir que essas permissões sejam alteradas futuramente.

---

# 18. Comunicação

O aplicativo não deve tentar substituir o WhatsApp.

A comunicação cotidiana continuará sendo realizada principalmente pelo WhatsApp para reduzir barreiras de adoção e preservar a proximidade entre os membros.

Entretanto, o Eagles App deve possuir mecanismos de integração e apoio ao WhatsApp.

Considere funcionalidades como:

- criar anúncios;
- preparar mensagens;
- gerar textos automaticamente;
- organizar comunicados;
- compartilhar eventos;
- compartilhar escala;
- compartilhar lembretes;
- compartilhar informações de presença;
- gerar mensagens segmentadas para grupos.

Sempre que tecnicamente possível, permita que uma informação criada no Eagles App seja facilmente compartilhada no WhatsApp.

Avalie cuidadosamente quais integrações são realmente possíveis sem depender de soluções caras ou excessivamente complexas.

---

# 19. Notificações

O sistema deverá possuir notificações automáticas.

Exemplos:

- lembrete de evento;
- confirmação de presença pendente;
- responsabilidade atribuída;
- alteração de escala;
- pagamento pendente;
- contribuição registrada;
- nova comunicação;
- mudança de grupo;
- lembrete de reunião;
- outros eventos relevantes.

As notificações devem ser configuráveis.

O usuário deve poder controlar determinadas preferências.

Evite excesso de notificações.

---

# 20. Inteligência Artificial

A IA será uma parte importante do Eagles App.

Ela deverá funcionar como uma ferramenta de apoio aos líderes e conselheiros, e não como autoridade final.

Considere funcionalidades como:

### Organização de grupos

- sugerir divisão equilibrada;
- analisar frequência;
- identificar desequilíbrios;
- sugerir reorganizações.

### Escalas

- gerar escala de responsabilidades;
- evitar repetições;
- sugerir substitutos;
- identificar conflitos.

### Participação

- identificar padrões de baixa frequência;
- gerar relatórios;
- destacar pessoas que podem precisar de atenção;
- identificar tendências.

### Comunicação

- gerar anúncios;
- adaptar mensagens;
- resumir informações;
- preparar mensagens para WhatsApp.

### Reuniões

- resumir atas, quando houver conteúdo fornecido;
- extrair tarefas;
- identificar responsáveis;
- acompanhar pendências.

### Administração

- gerar relatórios;
- responder perguntas sobre dados autorizados;
- encontrar pendências;
- auxiliar líderes na tomada de decisão.

### Financeiro

- resumir movimentações;
- identificar categorias;
- gerar relatórios;
- apontar inconsistências aparentes;
- auxiliar na prestação de contas.

A IA deve respeitar rigorosamente as permissões do usuário.

**Um membro nunca poderá utilizar a IA para acessar informações às quais não possui permissão.**

Dados sensíveis devem ser tratados com extremo cuidado.

---

# 21. Configurações

O sistema deve possuir configurações administrativas flexíveis.

Alguns recursos devem ser ativáveis/desativáveis.

Exemplos:

- check-in;
- aprovação de despesas;
- notificações;
- tipos de evento;
- categorias financeiras;
- responsabilidades;
- campos do cadastro;
- funções;
- permissões;
- critérios utilizados pela IA;
- configurações de grupos;
- recursos experimentais.

O sistema deve ser projetado para permitir expansão pós-lançamento.

---

# 22. Dashboard

Projete dashboards diferentes conforme a função do usuário.

O dashboard do líder deve priorizar informações como:

- próximos eventos;
- presença;
- pendências;
- situação dos grupos;
- responsabilidades;
- financeiro;
- notificações;
- pessoas novas;
- indicadores;
- alertas importantes.

O dashboard do conselheiro deve priorizar:

- seus grupos;
- participantes;
- frequência;
- responsabilidades;
- eventos;
- pendências;
- comunicação.

O dashboard do membro deve ser simples e focado em:

- próximos eventos;
- confirmação de presença;
- suas responsabilidades;
- grupo;
- notificações;
- contribuições;
- informações importantes.

O visitante deve possuir uma experiência extremamente simples.

---

# 23. Arquitetura tecnológica

Você deve decidir a stack tecnológica mais adequada.

Existe uma preferência explícita:

**Evite React e outros frameworks excessivamente populares em projetos construídos por IA quando houver alternativas tecnicamente maduras e adequadas.**

Não escolha uma tecnologia simplesmente por popularidade.

Compare alternativas considerando:

- custo;
- performance;
- experiência mobile;
- segurança;
- manutenção;
- facilidade de desenvolvimento;
- facilidade de hospedagem na VPS disponível;
- maturidade;
- comunidade;
- disponibilidade de bibliotecas;
- integração com banco de dados;
- suporte a PWA/mobile;
- capacidade de evolução;
- facilidade de contratação/manutenção futura.

Apresente pelo menos três alternativas antes da decisão final quando isso for relevante.

Depois recomende uma arquitetura e explique objetivamente a escolha.

Priorize uma arquitetura de baixo custo operacional.

---

# 24. Infraestrutura

Considere que já existe uma VPS disponível.

Projete uma infraestrutura que possa ser hospedada nela sempre que isso for tecnicamente adequado.

Avalie:

- aplicação;
- API;
- banco de dados;
- armazenamento de arquivos;
- backups;
- cache;
- filas;
- autenticação;
- observabilidade;
- logs;
- HTTPS;
- domínio;
- CI/CD;
- containers, se justificáveis.

Não introduza serviços pagos desnecessários.

Quando uma solução gratuita, self-hosted ou de baixo custo for adequada, considere-a.

---

# 25. Segurança

Segurança da informação é requisito crítico.

Projete obrigatoriamente:

- autenticação segura;
- autorização;
- RBAC;
- proteção de sessões;
- proteção contra acesso indevido;
- validação de entrada;
- proteção de APIs;
- criptografia adequada;
- proteção de dados pessoais;
- proteção de informações financeiras;
- controle de uploads;
- backups;
- recuperação de desastre;
- logs;
- auditoria;
- rate limiting;
- gestão segura de segredos;
- princípio do menor privilégio.

Avalie também riscos específicos de:

- dados pessoais;
- informações financeiras;
- fotografias;
- dados de menores, caso existam;
- IA;
- integrações externas;
- WhatsApp;
- arquivos anexados.

Não trate segurança como uma etapa posterior.

---

# 26. Banco de dados

Modele o banco de dados antes da implementação.

Identifique entidades, relacionamentos, cardinalidades, estados e regras de integridade.

Considere, no mínimo:

- usuários;
- perfis;
- funções;
- permissões;
- grupos;
- membros;
- visitantes;
- participantes recorrentes;
- eventos;
- presença;
- check-in;
- responsabilidades;
- escalas;
- movimentações financeiras;
- categorias;
- comprovantes;
- notificações;
- configurações;
- auditoria;
- histórico de alterações;
- interações relacionadas à IA.

Não crie entidades desnecessárias apenas para parecer sofisticado.

A estrutura deve ser suficientemente flexível para evolução.

---

# 27. UX/UI

Antes de implementar as telas, crie a arquitetura de informação.

Defina:

- navegação;
- menus;
- hierarquia;
- fluxos;
- telas;
- estados vazios;
- erros;
- carregamento;
- confirmações;
- permissões;
- responsividade.

Priorize mobile.

Para cada fluxo importante, descreva a experiência do usuário.

Exemplos:

**Novo visitante**
→ cadastro simples  
→ participação  
→ histórico  
→ evolução.

**Membro**
→ abre aplicativo  
→ vê próximos eventos  
→ confirma presença  
→ consulta responsabilidade  
→ acompanha informações.

**Conselheiro**
→ abre dashboard  
→ acompanha grupo  
→ verifica frequência  
→ ajusta escala  
→ envia anúncio.

**Líder**
→ acompanha visão geral  
→ analisa indicadores  
→ administra grupos  
→ acompanha financeiro  
→ utiliza IA para apoio.

---

# 28. Modularização

Divida o Eagles App em módulos independentes.

Uma sugestão inicial:

### Módulo 01 — Fundação

- arquitetura;
- infraestrutura;
- autenticação;
- banco;
- design system;
- configuração inicial.

### Módulo 02 — Pessoas

- usuários;
- visitantes;
- participantes recorrentes;
- membros;
- perfis;
- histórico.

### Módulo 03 — RBAC

- funções;
- permissões;
- políticas de acesso.

### Módulo 04 — Grupos/PGs

- criação;
- composição;
- reorganização;
- sugestões da IA.

### Módulo 05 — Eventos

- calendário;
- reuniões;
- PGs;
- Outside;
- outros eventos.

### Módulo 06 — Presença

- RSVP;
- histórico;
- relatórios;
- check-in opcional.

### Módulo 07 — Responsabilidades

- tarefas;
- escalas;
- automação;
- IA.

### Módulo 08 — Financeiro

- entradas;
- despesas;
- contribuições;
- doações;
- vendas;
- prestação de contas.

### Módulo 09 — Comunicação

- anúncios;
- notificações;
- compartilhamento;
- integração com WhatsApp.

### Módulo 10 — IA

- assistente;
- análises;
- automações;
- sugestões.

### Módulo 11 — Administração

- configurações;
- auditoria;
- relatórios;
- gerenciamento do sistema.

### Módulo 12 — Evolução

- funcionalidades futuras;
- integrações;
- novas funções;
- novos tipos de grupos;
- novas automações.

Você pode alterar essa divisão se identificar uma arquitetura melhor.

---

# 29. Processo de desenvolvimento

Siga uma abordagem incremental de Engenharia de Software.

Para cada módulo:

1. Defina o objetivo.
2. Liste os requisitos.
3. Identifique regras de negócio.
4. Identifique dependências.
5. Identifique riscos.
6. Modele os dados necessários.
7. Defina APIs e contratos.
8. Defina fluxos de UX.
9. Defina critérios de aceitação.
10. Implemente.
11. Teste.
12. Revise.
13. Corrija.
14. Documente.
15. Só então avance para o próximo módulo.

Não avance para um módulo dependente enquanto os fundamentos necessários não estiverem suficientemente estáveis.

---

# 30. Desenvolvimento iterativo

Você deverá trabalhar em ciclos.

Em cada ciclo:

**Planejamento → Implementação → Testes → Revisão → Correção → Validação**

Antes de iniciar cada módulo, explique:

- o que será construído;
- por que será construído;
- quais dependências existem;
- quais decisões precisam ser tomadas;
- quais riscos existem;
- qual será o resultado esperado.

Depois da implementação, revise o resultado contra os requisitos.

---

# 31. Critérios de qualidade

Considere uma implementação satisfatória somente quando:

- atender aos requisitos;
- respeitar as regras de negócio;
- respeitar RBAC;
- possuir tratamento adequado de erros;
- possuir validações;
- possuir testes adequados;
- possuir segurança compatível;
- possuir UX coerente;
- funcionar bem em mobile;
- possuir documentação suficiente;
- não introduzir complexidade desnecessária.

Sempre verifique seu trabalho antes de considerar um módulo concluído.

---

# 32. Gerenciamento de ambiguidades

Quando encontrar uma decisão importante que não esteja definida:

1. Identifique a ambiguidade.
2. Explique por que ela importa.
3. Apresente alternativas.
4. Recomende uma alternativa.
5. Pergunte ao usuário quando a decisão depender de uma preferência dos Eagles.

Quando a decisão for técnica e puder ser tomada com segurança, tome a decisão e registre a justificativa.

Não invente requisitos.

Diferencie claramente:

- requisito confirmado pelo usuário;
- sugestão;
- decisão técnica;
- hipótese;
- funcionalidade futura.

---

# 33. Padrão de interação

Você deverá trabalhar de maneira colaborativa.

Não faça dezenas de perguntas pequenas quando puder agrupar decisões relacionadas.

Quando houver informações suficientes para uma decisão, avance.

Quando faltar uma informação realmente crítica, faça perguntas objetivas.

Utilize perguntas abertas quando forem necessárias para compreender regras de negócio.

---

# 34. Primeira resposta obrigatória

Ao receber este prompt, **não escreva código**.

Sua primeira resposta deverá produzir um:

# DOCUMENTO DE DESCOBERTA E ARQUITETURA INICIAL

Com as seguintes seções:

1. Resumo executivo do Eagles App
2. Entendimento do problema
3. Objetivos do produto
4. Usuários e personas
5. Estrutura organizacional
6. Regras de negócio identificadas
7. Requisitos funcionais
8. Requisitos não funcionais
9. Módulos propostos
10. Fluxos principais
11. Modelo inicial de RBAC
12. Modelo inicial de dados
13. Arquitetura proposta
14. Comparação de stacks
15. Estratégia de hospedagem na VPS
16. Estratégia de segurança
17. Estratégia de IA
18. Estratégia de integração com WhatsApp
19. MVP recomendado
20. Roadmap pós-MVP
21. Riscos e pontos de atenção
22. Ambiguidades que precisam de decisão
23. Recomendações adicionais
24. Critérios de sucesso do produto

Ao final, apresente:

### DECISÕES QUE PRECISAM DA MINHA APROVAÇÃO

Liste somente as decisões realmente importantes que precisam ser aprovadas antes de iniciar a implementação.

Depois aguarde minha aprovação.

---

# 35. Regra fundamental de implementação

Após a aprovação da arquitetura, implemente o projeto **módulo por módulo**.

Nunca tente construir todo o Eagles App em uma única etapa.

Sempre mantenha a arquitetura, banco de dados, documentação e código consistentes entre os módulos.

Quando uma alteração em um módulo afetar outro módulo, explique o impacto antes de aplicá-la.

---

# 36. Código

Quando chegar o momento de escrever código:

- forneça código funcional;
- utilize padrões consistentes;
- mantenha separação de responsabilidades;
- evite duplicação;
- priorize legibilidade;
- documente decisões importantes;
- escreva testes;
- considere segurança;
- valide entradas;
- trate erros;
- mantenha compatibilidade com a arquitetura aprovada.

Quando gerar múltiplos arquivos, apresente primeiro a estrutura de diretórios.

Quando apropriado, forneça também mecanismos automatizados para criação da estrutura inicial do projeto.

---

# 37. Uso de IA durante o desenvolvimento

Use IA de maneira responsável.

Quando uma funcionalidade depender de um modelo de IA:

- identifique os dados necessários;
- avalie privacidade;
- defina permissões;
- defina limites;
- considere custos;
- estabeleça fallback;
- evite dependência desnecessária;
- registre decisões importantes.

Nunca permita que a IA execute automaticamente uma ação administrativa sensível sem considerar autorização humana.

Para ações relevantes, priorize:

**IA sugere → humano revisa → sistema executa.**

---

# 38. Evolução pós-lançamento

O sistema deve ser projetado para evoluir.

Não presuma que os requisitos atuais serão permanentes.

Prepare a arquitetura para futuras funcionalidades, como:

- novos papéis;
- novos tipos de eventos;
- novos critérios de grupos;
- novos tipos de responsabilidade;
- novos métodos de pagamento;
- novas integrações;
- novos relatórios;
- novos recursos de IA;
- novas equipes;
- novos campos de cadastro;
- novas regras administrativas.

Priorize extensibilidade sem criar complexidade prematura.

---

# 39. Princípios finais

Sempre siga estes princípios:

1. Simplicidade antes de complexidade.
2. Experiência humana antes de automação excessiva.
3. Segurança desde o início.
4. Mobile first.
5. Baixo custo operacional.
6. Arquitetura preparada para evolução.
7. IA como assistente, não como autoridade.
8. Líderes e conselheiros continuam responsáveis pelas decisões organizacionais.
9. Configurações devem permitir adaptar o sistema à realidade dos Eagles.
10. Evite funcionalidades desnecessárias.
11. Evite dependências excessivas.
12. Explique decisões técnicas importantes.
13. Valide requisitos antes de implementar.
14. Teste cada módulo.
15. Revise o trabalho antes de avançar.
16. Diferencie claramente requisitos confirmados, sugestões e hipóteses.

**O objetivo final não é criar apenas um aplicativo bonito.**

O objetivo é construir uma plataforma confiável que ajude os Eagles a organizar pessoas, grupos, encontros, responsabilidades, participação, recursos financeiros e processos internos durante todo o ano, mantendo a essência humana da comunidade.

Comece agora pelo **DOCUMENTO DE DESCOBERTA E ARQUITETURA INICIAL** e aguarde minha aprovação antes de escrever código.

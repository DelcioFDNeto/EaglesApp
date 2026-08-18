# ADR 0002 — Escopo do MVP: 6 módulos, sem financeiro e sem IA

- **Status:** aceita
- **Data:** 2026-08-18
- **Decisor:** usuário (D-02)

## Contexto

O briefing descreve 12 módulos. Construir todos antes de qualquer uso real levaria meses e entregaria um sistema calibrado por suposição, não por uso.

## Decisão

MVP com **6 módulos em ~10 semanas**: M01 Fundação, M02 Pessoas, M03 RBAC, M04 Grupos, M05 Eventos, M06 Presença — mais o botão de compartilhamento no WhatsApp.

**Financeiro (M09) na V1.2. IA (M10) na V2.0**, com a única exceção da redação de mensagens, antecipada para a V1.1 por não depender de histórico.

## Razões

**Critério de corte usado:** entra no MVP o que responde _sim_ a "sem isso, a liderança não consegue usar o app para o PG da próxima quinta-feira?"

- **Financeiro adiado** porque é alto valor para 3–5 pessoas. Adiá-lo não impede ninguém de usar o app; adiar presença impediria todo mundo.
- **IA adiada** porque quase toda funcionalidade de IA do briefing depende de histórico: sugerir divisão de grupos exige meses de frequência registrada, gerar escala exige histórico de responsabilidades, identificar afastamento exige série temporal. Estimo 8–12 semanas de uso real antes que gere valor honesto. Uma sugestão ruim na primeira semana queima a confiança da liderança na funcionalidade permanentemente.
- **Comunicação antes de Financeiro** (V1.1 vs V1.2) porque o compartilhamento no WhatsApp é o que faz o app circular na comunidade e sustenta a adoção — o risco número um do projeto.

## Consequências

- Nos primeiros meses a prestação de contas continua na planilha. É uma regressão aceita conscientemente.
- O banco começa a acumular histórico de frequência desde a semana 10, o que é exatamente o insumo que o M10 vai precisar.
- **Administração (M11) é transversal**: cada módulo entrega junto suas próprias configurações e eventos de auditoria, em vez de deixar constantes fixadas no código para parametrizar depois.

## Lançamento

Não lançar para todos de uma vez. **Um PG piloto por 3 semanas**, com um conselheiro paciente e comunicativo, antes de abrir para os demais. O custo de um lançamento geral ruim é a comunidade concluir coletivamente que "aquele app não funciona" — impressão quase impossível de reverter.

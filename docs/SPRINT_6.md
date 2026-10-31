# Gateseeker — Sprint 6: o produto vigia por você

> Status: **proposta para aprovação do PO**, escrita em 2026-10-31. Continua `docs/ROADMAP.md` (Sprint 6, itens U3, U4 e U6, decisão 3). Nenhum código começa antes da aprovação deste documento e das decisões do §8, que incluem o primeiro serviço de e-mail do projeto.
> Última atualização: 2026-10-31

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano, que não é desenvolvedor: apresente decisões em linguagem simples. As regras de trabalho, a stack e os controles de segurança das sprints anteriores continuam valendo. Esta sprint propõe um serviço hospedado novo (e-mail) e uma credencial nova (token de leitura do GitHub), ambos sujeitos à aprovação do §8.

## 1. Objetivo da sprint

Ameaças aparecem todos os dias, e o nosso público não volta sozinho para analisar de novo. Até a Sprint 5 o Gateseeker responde bem "o que está errado agora"; a Sprint 6 faz ele **avisar quando algo novo aparece**, sem a pessoa precisar lembrar de perguntar.

Entregas:

1. **Histórico no servidor** (U3): "meus repositórios" e "minhas análises" passam a vir do banco, não só do navegador. Funciona em qualquer dispositivo.
2. **Comparação entre análises** (U4): cada nova análise de um repositório mostra o que é **novo**, o que foi **corrigido** e o que **continua aberto** em relação à anterior.
3. **Seguir um repositório**: a pessoa liga "me avise" num repositório. O serviço reanalisa todo dia e também logo depois que um registro novo é aprovado no feed curado.
4. **E-mail só quando há algo novo**: um e-mail curto por repositório, com os achados novos de prioridade P1 ou P2 e o link para o relatório. Nunca a lista inteira de novo, nunca segredo, sempre com descadastro de um clique.
5. **Feed sem redeploy** (U6): um registro aprovado hoje passa a valer na página hoje, sem esperar uma nova publicação do site.

**Hipótese a validar:** ser avisado vale mais do que lembrar de perguntar. Métricas (do roadmap): 30 repositórios seguidos; pelo menos 40% dos e-mails de alerta levam a uma visita ao relatório.

## 2. Princípios específicos

1. **Avisar pouco e com razão.** Um e-mail só sai quando a comparação encontra um achado novo P1 ou P2 num repositório seguido. Achado que já existia não gera e-mail; P3 e P4 aparecem no relatório, não no e-mail. No máximo um e-mail por repositório por dia.
2. **O e-mail não carrega dados sensíveis.** Repositório, título da regra ou do advisory, prioridade e link. Nenhum trecho de código, nenhum valor de segredo (nem redigido), nenhum caminho além do arquivo. O detalhe fica no relatório, que exige login.
3. **Incompleto continua incompleto.** Se a reanálise falhar (GitHub fora, OSV fora, repositório ficou privado ou foi apagado), a pessoa vê "não foi possível verificar" na tela; não vê "nenhum problema novo". Três falhas seguidas geram um único e-mail avisando que o acompanhamento está parado.
4. **Consentimento explícito e reversível.** Seguir é uma ação da pessoa, repositório por repositório. Descadastrar funciona sem login, por um link assinado no próprio e-mail, e também em Configurações. Apagar a conta apaga tudo.
5. **Um motor só.** Reanálise e comparação usam o mesmo `scanDirectory` e as mesmas regras da CLI. A comparação fica no motor (`src/report/compare.ts`), para a CLI e a Action poderem usar depois.

## 3. Escopo

### 3.1. Histórico no servidor (U3)

- Nova tabela `scans`, uma linha por análise concluída: usuário, repositório, commit, veredito, contagem por prioridade, id do relatório salvo e data. Guardada por 180 dias; o relatório completo continua guardado por 30 dias, como hoje.
- `GET /api/scans` devolve o histórico da pessoa. As telas Dashboard e Scans passam a usar o servidor; o `localStorage` vira só cache, para a tela abrir rápido.
- Sem migração do que já está no navegador de cada pessoa: o histórico novo começa na data do lançamento (dito na tela).

### 3.2. Comparação entre análises (U4)

- `src/report/compare.ts` compara dois relatórios do mesmo repositório e classifica cada achado como novo, corrigido ou continua.
- A chave de comparação não depende de número de linha, que muda a cada edição:
  - dependência: id da vulnerabilidade + nome do pacote (se o pacote subiu de versão e continua vulnerável, conta como "continua", não como novo);
  - padrão de código: regra + arquivo + impressão digital do trecho já redigido (hash, nunca o texto);
  - supply chain: regra ou advisory + pacote.
- Na tela, o relatório de um repositório já analisado ganha uma faixa no topo: "2 novos · 3 corrigidos · 5 continuam desde 28/10", com filtro por esses três estados.

### 3.3. Seguir um repositório

- Botão **Follow** na tela do relatório e na lista de Scans. Nova tabela `follows` (usuário, repositório, ligado em, último resultado, falhas seguidas).
- Limite inicial de 10 repositórios seguidos por conta, para caber no plano gratuito do e-mail e do Vercel (ajustável).
- Só repositórios públicos, como o resto do serviço. Se um repositório seguido ficar privado ou for apagado, o acompanhamento para e a pessoa é avisada uma vez.

### 3.4. Reanálise agendada e por evento

- **Diária:** o cron do Vercel (no plano gratuito, uma vez por dia, em horário aproximado) chama `/api/cron/monitor`. Cada chamada processa os repositórios seguidos mais antigos até perto do tempo máximo da função e deixa o resto para o dia seguinte, sem passar do limite.
- **Por evento:** quando um registro novo é aprovado no feed (ver 3.5), os repositórios seguidos do mesmo ecossistema entram na fila na frente dos outros.
- **Cache:** hoje a mesma análise é reaproveitada por 24 horas para o mesmo commit. A chave passa a incluir a versão do Gateseeker e o resumo (digest) do feed curado: se o feed mudou, o mesmo commit é analisado de novo.
- **GitHub:** cada reanálise faz duas chamadas à API pública do GitHub. Sem token, o limite é 60 por hora por endereço IP, e os IPs do Vercel são compartilhados. Por isso a sprint propõe um token de leitura sem acesso a repositório nenhum (§8.3), só para subir esse limite.

### 3.5. Feed sem redeploy (U6)

- Quando um PR de registros aprovados entra na `main`, um passo novo do workflow do feed publica o conjunto aprovado (o mesmo `advisories.json` do build) no Supabase, assinado com HMAC por uma chave que só o workflow e o serviço conhecem.
- O serviço lê o conjunto mais recente do banco, confere a assinatura e o digest, e só então o usa. Se a assinatura não confere ou o banco não responde, usa o conjunto embutido no build e diz no relatório qual usou. Nunca analisa sem feed sem dizer.
- Depois de publicar, o workflow chama `/api/feed/published` (autenticado pela mesma chave) para pôr na fila os repositórios seguidos.

### 3.6. E-mail

- Provedor: **Brevo**, onde o PO já tem conta (2026-10-31). O plano gratuito permite 300 e-mails por dia (cerca de 9.000 por mês) com envio transacional por API, mais folga diária que o Resend (100 por dia); em troca, os e-mails do plano gratuito levam a marca do Brevo, e o primeiro plano pago custa cerca de US$ 9 por mês. Valores de sites de comparação, a conferir na conta. O envio fica atrás de uma interface pequena no serviço, para trocar de provedor sem mexer no resto.
- Remetente num domínio do produto, com SPF, DKIM e DMARC configurados (depende do domínio, §8.2).
- O endereço vem da conta GitHub da pessoa no Supabase Auth. O Gateseeker não copia o e-mail para tabela própria; busca no momento do envio.
- Tipos de e-mail: confirmação ao seguir (com descadastro), alerta de achado novo P1/P2, aviso de acompanhamento parado. Texto simples e uma versão HTML mínima, com todo dado do repositório escapado; nenhum link montado a partir de conteúdo do repositório, só links do próprio Gateseeker.
- Descadastro de um clique: link com token assinado (HMAC, sem expiração, um por repositório seguido) e cabeçalho `List-Unsubscribe`.
- Teto diário de envios abaixo do limite do provedor; ao chegar nele, o restante fica para o dia seguinte e o painel registra.

### 3.7. Instrumentação

Contadores agregados, como na Sprint 4: repositórios seguidos, reanálises (concluídas, incompletas, falhas), e-mails enviados por tipo, cliques no link do e-mail (pelo parâmetro do próprio link, sem pixel de rastreamento) e descadastros.

## 4. Testes obrigatórios

1. Comparação: mesma vulnerabilidade com versão diferente do pacote conta como "continua"; achado de padrão que mudou de linha conta como "continua"; achado removido conta como "corrigido"; relatório anterior incompleto não gera "corrigido" para o que não foi verificado.
2. Alerta: só achado novo P1/P2 de repositório seguido gera e-mail; nunca mais de um por repositório por dia; reanálise incompleta não gera alerta de "nada novo" nem de "corrigido".
3. Conteúdo do e-mail: nenhum valor de `fixtures/projects/secrets.json` e nenhum trecho de código; nomes hostis de repositório e de pacote chegam escapados no HTML e limpos no texto.
4. Descadastro: token válido desliga só aquele acompanhamento; token adulterado é recusado; funciona sem sessão.
5. Feed: assinatura inválida ou ausente faz o serviço voltar ao conjunto embutido e dizer isso no relatório; digest novo invalida o cache do mesmo commit.
6. Cron: com fila maior que o tempo disponível, a chamada para antes do limite e retoma no dia seguinte; o endpoint exige o segredo do cron.
7. Seguir: limite por conta, repositório que ficou privado para o acompanhamento e avisa uma vez.
8. Nenhum teste chega à rede: Resend, GitHub, OSV e Supabase são dublês com `fetch` injetado, como hoje.

## 5. Segurança e privacidade

- `docs/THREAT_MODEL.md` ganha a superfície "monitoramento e e-mail":
  - abuso para mandar e-mail a terceiros: impossível, porque só se segue com a própria conta e o e-mail vai só para o dono da conta;
  - spam por volume: limite de repositórios seguidos e teto diário;
  - conteúdo hostil no e-mail: escape e lista fechada de campos;
  - falsificação do feed: assinatura HMAC;
  - descadastro forjado: token assinado;
  - credenciais novas: chave do Resend, chave de assinatura do feed e token do GitHub ficam só nas variáveis de ambiente do Vercel e nos segredos do workflow, nunca no repositório.
- Dados pessoais: o único novo uso é o e-mail da conta, para avisos que a pessoa pediu. A página About ganha uma seção de privacidade em linguagem simples: o que é guardado, por quanto tempo, como apagar.
- As tabelas novas seguem o padrão atual: RLS ligado, sem políticas, acesso só pela chave de serviço.

## 6. Critérios de aceite

- Histórico, comparação e acompanhamento funcionando na página publicada, em dois dispositivos diferentes para a mesma conta.
- Um registro aprovado no feed gera, no mesmo dia, reanálise e e-mail para um repositório de teste seguido que tenha o pacote afetado.
- Descadastro pelo link do e-mail funciona sem login.
- Nenhum e-mail com segredo ou trecho de código (teste 3).
- `pnpm check` e `pnpm test:e2e` verdes; THREAT_MODEL, ARCHITECTURE, DEPLOY e README atualizados.

## 7. Fora de escopo

Repositórios privados e GitHub App (Sprint 7), alertas por Slack ou webhook, frequência configurável de reanálise, resumo semanal, cobrança, times, acompanhamento sem login, A2 (verificar pacotes que não existem).

## 8. Decisões que precisam do PO antes de começar

1. **Serviço de e-mail (decisão 3 do roadmap): Brevo**, indicado pelo PO em 2026-10-31 (já tem conta). Falta confirmar: manter o plano gratuito até o lançamento, aceitando a marca do Brevo nos e-mails, e criar a chave de API transacional (vai só para as variáveis do Vercel).
2. **Domínio para o remetente.** E-mail confiável precisa de um domínio próprio com SPF/DKIM/DMARC. Sem domínio, a sprint entrega tudo menos o envio real (os e-mails ficam registrados no painel de teste). Recomendação: registrar `gateseeker.dev` (ou `.io`) agora; custa cerca de US$ 15 a 40 por ano e também serve para o site.
3. **Token de leitura do GitHub** para as reanálises (variável `GITHUB_TOKEN`, que o serviço já aceita): um token "fine-grained" sem acesso a nenhum repositório, só para subir o limite da API pública. Recomendação: sim, criado na conta do PO ou da organização `gateseeker-dev`.
4. **Plano do Vercel.** No gratuito, a reanálise é diária e o horário é aproximado. Recomendação: manter o gratuito nesta sprint (diária é suficiente para a hipótese) e reavaliar no lançamento, quando o Pro (US$ 20 por usuário por mês) já é necessário pelos termos de uso comercial.
5. **Limites iniciais:** 10 repositórios seguidos por conta, um e-mail por repositório por dia, histórico de 180 dias. Recomendação: aprovar assim e ajustar com dados.

## 9. Ordem de trabalho

1. Comparação no motor (`compare.ts`) com os testes 1, e a faixa novo/corrigido/continua na tela. Não depende de nenhuma decisão.
2. Histórico no servidor: tabela `scans`, `GET /api/scans`, Dashboard e Scans lendo do servidor (migração SQL para o PO aplicar).
3. Seguir e reanálise diária: tabela `follows`, botão, `/api/cron/monitor` com fila e retomada, chave de cache com versão e digest do feed.
4. Feed sem redeploy: publicação assinada no workflow, leitura e verificação no serviço, gatilho de reanálise.
5. E-mail (depende de 8.1 e 8.2): envio, modelos, descadastro, teto diário.
6. Privacidade, documentação, validação ponta a ponta com um repositório de teste seguido.

Os passos 1 e 2 podem começar assim que este documento for aprovado, enquanto o PO cuida das contas (e-mail, domínio, token).

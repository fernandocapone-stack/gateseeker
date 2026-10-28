# Sprint 4 — Gateseeker na web: cole a URL, receba o relatório

> Status: **rascunho para aprovação do PO**. Nada desta sprint foi codado.
> Última atualização: 2026-10-28

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano, que não é desenvolvedor: apresente decisões em linguagem simples. As regras de trabalho, a stack e os controles de segurança das sprints anteriores continuam valendo, com uma exceção explícita nesta sprint: ela introduz os primeiros serviços hospedados e as primeiras dependências novas, listados na seção 8 para aprovação.

## 1. Objetivo da sprint

Hoje o Gateseeker só existe para quem tem terminal ou GitHub Actions. A Sprint 4 cria a **porta de entrada para quem não instala nada**: uma página onde a pessoa cola o endereço de um repositório público do GitHub e, em até um minuto, vê o relatório priorizado, com um link que pode compartilhar. É a mesma análise da CLI e da Action, com o mesmo motor, as mesmas regras e a mesma linguagem; só muda quem aperta o botão.

Por que agora: o motor está completo e validado (Sprints 0 a 3), e o que falta é descoberta. Um fundador que usa Lovable não vai ler o README de uma Action; vai colar a URL do projeto dele, ver três achados com ação concreta e aí sim instalar o portão no CI. A página é o funil para a Action, e é também o primeiro lugar onde um plano pago pode existir.

Entregas:

1. **Página pública** `gateseeker.dev` (ou o domínio que o PO registrar): campo para a URL, botão, relatório na mesma tela, link permanente `/r/<id>` para compartilhar.
2. **Serviço de análise** que baixa o repositório público como arquivo compactado, roda o motor existente dentro dos limites já definidos para entrada não confiável e devolve o relatório. Nunca executa nada do projeto analisado; nunca usa git.
3. **Persistência mínima** dos relatórios (30 dias) e uma lista de espera para quem quiser histórico, repositórios privados e times.
4. **Instrumentação honesta**: contagem de análises, de links abertos e de cliques em "usar no CI", sem rastreamento de pessoas.

**Hipótese a validar** (de `docs/PRODUCT.md`): alguém que nunca ouviu falar do produto cola uma URL e encontra valor em um minuto. Métrica pós-sprint: 100 análises de repositórios distintos em 30 dias, 20 links compartilhados abertos por terceiros, 10 cliques em "usar no CI" vindos da página.

## 2. Princípios específicos

1. **Um motor só.** A página chama `scanDirectory` do pacote `gateseeker` publicado no npm, na versão fixada; nenhuma regra, prioridade ou texto é reimplementado na web. Se a web precisa de algo que o motor não dá, o motor ganha a função e a CLI ganha junto.
2. **O servidor é um usuário comum do motor.** Mesmos limites de tamanho e quantidade de arquivos, mesmo tratamento de conteúdo como não confiável, mesma redação de segredos. O servidor não tem privilégio nenhum sobre o repositório analisado além de poder baixá-lo, e só baixa o que é público.
3. **Nada é executado, nada é clonado.** O repositório chega como um `.tar.gz` do GitHub, é descompactado por código nosso com limites rígidos, e o motor lê arquivos. Sem `git`, sem `npm install`, sem `composer install`, sem processos filhos.
4. **Segredo encontrado nunca é armazenado.** O motor já redige segredos nos achados; o relatório persistido é o mesmo JSON da CLI, e um teste garante que nenhum valor completo de credencial passa pela redação antes de ir ao banco.
5. **A linguagem do produto é a mesma.** Nunca "seguro"; sempre "nenhuma vulnerabilidade conhecida foi encontrada nas fontes consultadas". A página diz o que não cobre, com a mesma lista de limitações do relatório.
6. **Incompleto continua incompleto.** Se o OSV falhar ou o repositório estourar um limite, a página mostra "análise incompleta" com o motivo, nunca um relatório vazio que pareça aprovação.
7. **Sem conta para começar.** Colar a URL e ver o relatório não exige cadastro. Conta só entra quando houver algo que precise dela (histórico, privado, times), e isso é outra sprint.

## 3. Escopo

### 3.1. Página (`web/`, pacote novo no workspace)

- Vite + React + Tailwind + os componentes shadcn-style já existentes em `ui/` (extraídos para um pacote interno `@gateseeker/ui-kit` para as duas interfaces usarem o mesmo tema Sentry).
- Rotas: `/` (campo de URL e relatório), `/r/<id>` (relatório salvo, compartilhável), `/ci` (como instalar a Action, com o trecho de três linhas), `/limits` (o que a análise cobre e não cobre).
- Estados: digitando, analisando (com progresso textual: "baixando", "lendo 312 arquivos", "consultando OSV"), concluído, incompleto, recusado (URL inválida, repositório privado ou inexistente, limite estourado, fila cheia).
- O relatório na tela é a mesma informação do `--format summary`, com os achados expandíveis para mostrar evidência, regra e referência, como no texto da CLI.
- Botão "Usar no CI" que leva a `/ci` já com o nome do repositório preenchido no exemplo.
- Lista de espera: um campo de e-mail opcional, com a pergunta "o que você gostaria: histórico, repositórios privados, times, PHP, outra coisa". Sem newsletter, sem terceiros.

### 3.2. Serviço de análise (Vercel Function, Node 24)

- `POST /api/scan` com `{ url }`. Aceita só `https://github.com/<dono>/<repo>` (com `/tree/<ref>` opcional), validado por expressão regular estrita. Qualquer outra coisa é recusada antes de qualquer requisição de rede.
- Resolve o repositório pela API pública do GitHub (sem token) para confirmar que existe, é público e obter o ramo padrão e o commit; recusa repositórios acima de um tamanho declarado (limite inicial: 100 MB) e arquivados há mais de dois anos.
- Baixa o `.tar.gz` do commit resolvido (`codeload.github.com`), com limite de 25 MB comprimidos e de tempo. Descompacta em `/tmp` com um leitor de tar próprio (sem dependência), que recusa caminhos absolutos, `..`, links simbólicos e links físicos, e para ao atingir os mesmos limites do motor (5000 arquivos, 1 MB por arquivo de texto).
- Chama `scanDirectory` com os limites padrão, `patterns: warn`, `supply-chain: warn`, sem baseline (não há "antes" na web). Tempo máximo total: 120 segundos; acima disso, veredito incompleto com motivo "tempo esgotado".
- Grava o relatório e devolve `{ id, report }`. `GET /api/report/<id>` devolve o relatório salvo.
- Limites de uso por IP (10 análises por hora) e globais (fila de no máximo 5 análises simultâneas), guardados no banco; excedeu, resposta 429 com mensagem clara.
- Cache por commit: a mesma URL no mesmo commit dentro de 24 horas devolve o relatório existente, sem repetir a análise. O cache tem validade curta de propósito: o OSV muda.

### 3.3. Persistência (Supabase, Postgres)

Três tabelas, todas sem dados pessoais além do e-mail opcional da lista de espera:

- `reports`: id, dono/repo, commit, versão do Gateseeker, JSON do relatório, criado em, expira em (30 dias). Sem IP.
- `rate_limits`: hash do IP (com sal diário, não reversível), contagem, janela.
- `waitlist`: e-mail, interesse, criado em.

Acesso ao banco só pelo serviço, com a chave de serviço em variável de ambiente do Vercel; o navegador nunca fala com o Supabase diretamente, e Row Level Security fica ligado com política "nenhum acesso anônimo", porque é exatamente o erro GSK-SUPABASE-001 que o produto aponta nos outros.

Limpeza: uma função agendada (Vercel Cron, diária) apaga relatórios expirados.

### 3.4. Instrumentação

Contadores agregados, sem cookies e sem identificação: análises iniciadas, concluídas, incompletas, recusadas (por motivo), relatórios abertos por link, cliques em "Usar no CI", inscrições na lista. Uma tabela `events` com tipo e dia, sem IP, sem user agent. Vercel Web Analytics desligado nesta sprint; se o PO quiser mapa de origem de tráfego, é decisão à parte.

### 3.5. Validação

- Dez repositórios públicos reais de vibe coding (os cinco da Sprint 1 e cinco novos, propostos ao PO antes), analisados pela página, com tempo total e resultado comparados à CLI local no mesmo commit: os achados têm que ser idênticos.
- Cinco repositórios grandes conhecidos (ex.: `vercel/next.js`, `laravel/laravel`) para confirmar que a recusa por tamanho e o tempo máximo funcionam e que a mensagem é compreensível.
- Resultado em `docs/VALIDATION_SPRINT_4.md`.

## 4. Testes obrigatórios

1. Leitor de tar: fixtures com caminho absoluto, `..`, link simbólico, link físico, arquivo acima do limite, mais de 5000 entradas e tarball truncado; todos recusados com erro específico, nada escrito fora da pasta temporária.
2. Validador de URL: tabela de entradas aceitas e recusadas (GitLab, GitHub Enterprise, `github.com/dono` sem repo, URLs com credenciais, `javascript:`, espaços, unicode parecido).
3. Serviço: com `fetch` injetado (sem rede), cobre repositório inexistente, privado, grande demais, download truncado, OSV fora do ar (veredito incompleto), e o caminho feliz com o relatório igual ao da CLI para a mesma fixture.
4. Persistência: relatório gravado não contém nenhum valor completo das credenciais sintéticas das fixtures (reuso de `fixtures/projects/secrets.json`).
5. Limite de uso: a 11ª análise na mesma hora recebe 429; a hora seguinte libera.
6. Página: Playwright cobre colar URL válida, ver relatório, abrir o link `/r/<id>` em outra sessão, URL inválida, análise incompleta.
7. Tempo de ReDoS: o validador de URL e o leitor de tar passam pelo mesmo teste de tempo das regras de padrão.

## 5. Segurança adicional

- `docs/THREAT_MODEL.md` ganha a superfície "serviço web": entrada hostil via URL, via conteúdo do tarball (zip bomb, caminhos, links), via volume (abuso do limite de uso para gastar a cota do OSV ou do Vercel), e via relatório compartilhado (um link `/r/<id>` com nome de pacote malicioso é renderizado como texto, nunca como HTML ou link clicável construído a partir do conteúdo).
- Ids de relatório aleatórios de 128 bits; não enumeráveis.
- Cabeçalhos: CSP estrita sem inline, sem scripts de terceiros; `Referrer-Policy` sem vazamento do id.
- Nenhum token de GitHub no serviço nesta sprint. Se o limite anônimo da API do GitHub (60 requisições por hora por IP) apertar, a alternativa é um token de leitura mínimo em variável de ambiente, decisão à parte.
- O domínio e as contas Vercel e Supabase ficam na organização `gateseeker-dev` ou em contas do PO; nenhuma credencial entra no repositório.

## 6. Critérios de aceite

- Colar `https://github.com/<dono>/<repo>` de um projeto público de tamanho normal devolve o relatório em menos de 60 segundos na maioria dos casos validados, com os mesmos achados da CLI no mesmo commit.
- Repositório privado, inexistente ou grande demais recebe uma recusa clara em menos de 5 segundos.
- OSV indisponível produz "análise incompleta" visível, nunca um relatório vazio.
- Link `/r/<id>` abre o relatório sem cadastro e expira em 30 dias.
- Nenhum relatório persistido contém segredo completo (teste 4).
- `pnpm check` cobre o pacote `web/`; CI verde; deploy de preview por PR no Vercel.
- README ganha a seção "Try it in the browser"; PRODUCT, ARCHITECTURE e THREAT_MODEL atualizados.

## 7. Fora de escopo

Contas, login, histórico por usuário, repositórios privados, GitLab e Bitbucket, análise de uma pasta enviada pelo navegador, baseline na web, explicações por IA, correção automática, cobrança. A lista de espera serve para medir demanda por essas coisas antes de construí-las.

## 8. Decisões que precisam do PO antes de começar

1. **Aprovação deste escopo.**
2. **Serviços hospedados e seu custo** (primeira vez no projeto; `CLAUDE.md` exige aprovação):
   - **Vercel.** O plano gratuito (Hobby) tem tudo que a sprint precisa (funções de até 5 minutos, 2 GB de memória), mas **proíbe uso comercial** nos termos de uso. Para um produto, o plano é o Pro, US$ 20 por mês por usuário. Recomendação: começar no Hobby durante o desenvolvimento e a validação, e passar para o Pro no dia em que a página for divulgada.
   - **Supabase.** O plano gratuito (500 MB, 2 projetos) basta para a sprint, com uma pegadinha: o projeto é **pausado após uma semana sem atividade**, e a página pararia de funcionar. O cron diário de limpeza conta como atividade e evita a pausa. O plano Pro custa US$ 25 por mês. Recomendação: gratuito até a divulgação.
   - **Domínio.** `gateseeker.dev` ou `.io`, registrado pelo PO; cerca de US$ 15 a 40 por ano. Sem domínio, a página sai em `gateseeker.vercel.app`, o que serve para validar.
3. **Dependências novas** (regra 8 do `CLAUDE.md`): `@supabase/supabase-js` no serviço e as já usadas em `ui/` para a página (React, Tailwind, Vite). O motor continua com `zod` como única dependência de runtime; o leitor de tar é código nosso, sem dependência, justamente para não trazer um descompactador de terceiros para o ponto mais exposto do serviço.
4. **Os cinco repositórios novos da validação**, propostos antes de qualquer análise.
5. **Um ponto de design**: a página é o primeiro contato visual do produto, e o tema Sentry da triagem será a base. O PO decide se trabalha o visual em paralelo, como na Sprint 2a-UI, ou depois da validação.

## 9. Ordem de trabalho

1. Leitor de tar e validador de URL, com todos os testes (não dependem de nada hospedado).
2. Serviço de análise rodando localmente contra o motor publicado, com `fetch` injetado nos testes.
3. Página com relatório na tela, sem persistência (link compartilhável vem depois).
4. Supabase: tabelas, limites de uso, cache por commit, cron de limpeza, links `/r/<id>`.
5. Deploy no Vercel, validação com os dez repositórios, documento de validação.
6. README, PRODUCT, ARCHITECTURE, THREAT_MODEL.

Os passos 1 a 3 não dependem de nenhuma conta nem custo; começam assim que o escopo for aprovado, enquanto o PO cria as contas e registra o domínio para o passo 4.

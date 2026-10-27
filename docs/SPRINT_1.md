# Gateseeker — Sprint 1: padrões inseguros em código gerado por IA

> Status: **proposta, aguardando aprovação do PO**. Depende da Sprint 0 concluída (CI verde em 2026-10-27).
> Última atualização: 2026-10-27

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano. As regras de trabalho, a stack e os controles de segurança da Sprint 0 (`docs/SPRINT_0.md`, seções 2, 3 e 5) continuam valendo integralmente e não são repetidos aqui.

## 1. Objetivo da sprint

Entregar a primeira capacidade que `npm audit`, Dependabot e Snyk gratuito não têm: detectar, de forma determinística e sem executar nada, os erros de segurança mais frequentes em projetos JavaScript/TypeScript gerados ou assistidos por IA (Lovable, v0, Bolt, Cursor, Replit, Copilot).

Ao fim da sprint, `gateseeker scan <pasta-do-projeto>` analisa dependências **e** código, e cada achado de código é um `Finding` com `kind: "insecure-pattern"`, mesma estrutura, mesma priorização e mesmo relatório da Sprint 0.

**Hipótese a validar:** desenvolvedores que constroem com essas ferramentas reconhecem os achados como reais e acionáveis. Métrica: 5 projetos reais analisados, ao menos 3 desenvolvedores dizem que corrigiriam algo apontado, e precisão por regra acima de 90% nos projetos avaliados.

## 2. Princípios específicos desta sprint

1. **Precisão antes de cobertura.** Uma regra que gera falso positivo faz o dev desinstalar a ferramenta. Cada regra nasce com fixtures positivas e negativas e um orçamento explícito de falsos positivos. Regra sem ambos não entra.
2. **Determinismo.** Regras são correspondência estrutural ou léxica sobre arquivos. Nenhum modelo de linguagem decide se há um problema.
3. **Modo aviso por padrão.** Nesta sprint, achados de `insecure-pattern` aparecem no relatório e no terminal com prioridade, mas **não** mudam o veredito do portão, salvo com `--patterns gate`. O gate continua sendo decidido por dependências até que a precisão seja medida em projetos reais.
4. **Segredos nunca são copiados.** Evidência de um segredo mostra os 4 primeiros caracteres e o comprimento, nunca o valor. Isso vale para relatório JSON, terminal e logs.
5. **Nada é executado.** Nenhum `require`, `import`, `eval`, build, instalação ou leitura de `.git/`. Arquivos são texto.
6. **Ignorar o que não é código do usuário.** `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `out/`, `coverage/`, `vendor/`, arquivos minificados e binários não são analisados.

## 3. Escopo

### 3.1. Varredura de projeto

Um módulo `src/patterns/walker.ts` que percorre uma pasta e entrega arquivos para as regras.

- Limites configuráveis: máximo de arquivos (padrão 5000), tamanho por arquivo (padrão 1 MB), profundidade (padrão 20). Exceder qualquer um interrompe com erro controlado, código de saída 3, e nunca resulta em `pass` silencioso.
- Lista de exclusão fixa (seção 2, item 6) mais padrões vindos de `.gitignore` na raiz, lidos como texto (sem executar git).
- Detecção de binário por bytes nulos no início do arquivo; arquivos binários são pulados e contados.
- Links simbólicos não são seguidos.
- Cada arquivo é classificado em `client`, `server`, `config`, `sql`, `env`, `rules`, `test` ou `other` por caminho e extensão, para que regras possam restringir onde se aplicam. Heurística documentada em `docs/ARCHITECTURE.md`; a classificação aparece na evidência de cada achado para auditoria.

### 3.2. Conjunto inicial de regras

Cada regra tem id estável `GSK-<AREA>-<NNN>`, severidade intrínseca, escopo de arquivos, evidência e ação. A severidade entra na mesma matriz da Sprint 0; a exposição é `direct-prod` para código do projeto e `dev-only` para arquivos classificados como `test`.

| Id | Regra | Severidade | Como detecta | Falso positivo evitado |
|---|---|---|---|---|
| `GSK-SECRET-001` | Segredo de formato conhecido hardcoded | CRITICAL | Padrões de alta precisão por formato de provedor: AWS (`AKIA` + 16), Stripe (`sk_live_`, `rk_live_`), GitHub (`ghp_`, `github_pat_`), OpenAI (`sk-proj-`, `sk-`), Anthropic (`sk-ant-`), Google (`AIza` + 35), Slack (`xox[bap]-`), chave privada PEM (`-----BEGIN ... PRIVATE KEY-----`), JWT com `"role":"service_role"` no payload (Supabase). | Chaves de teste (`sk_test_`), `.env.example`, arquivos `test`, placeholders (`xxx`, `your-key-here`, `<...>`), e entropia mínima para padrões curtos. |
| `GSK-SECRET-002` | Segredo de servidor exposto ao bundle do cliente | CRITICAL | Variável com prefixo público (`NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `NUXT_PUBLIC_`) cujo nome contém `SECRET`, `SERVICE_ROLE`, `PRIVATE`, `PASSWORD`, `TOKEN` ou `API_KEY` sem estar em lista de chaves públicas conhecidas (`ANON_KEY`, `PUBLISHABLE`, `CLIENT_ID`, `SITE_URL`, `PROJECT_ID`, Firebase config). Procura em `.env*`, `next.config.*`, `vite.config.*` e código-fonte. | Lista de nomes públicos; comentários. |
| `GSK-SUPABASE-001` | Tabela criada sem Row Level Security | HIGH | Em `supabase/migrations/*.sql` e `*.sql` sob `supabase/`: `CREATE TABLE <t>` sem `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` em nenhuma migração, ou com `DISABLE ROW LEVEL SECURITY` posterior. Comparação por nome normalizado (schema, aspas, case). | Tabelas em schemas não expostos (`auth`, `storage`, `extensions`, `private`); migrações que fazem `enable` em arquivo posterior. |
| `GSK-SUPABASE-002` | Chave `service_role` usada em código de cliente | CRITICAL | Em arquivos classificados `client` (`"use client"`, `components/`, `app/` fora de `api/` e `route.*`, `pages/` fora de `pages/api/`, `src/` em projetos Vite): `createClient(` com argumento que referencia variável contendo `SERVICE_ROLE` ou JWT literal com `role: service_role`. | Arquivos `server`, `route.ts`, `middleware.ts`, scripts, `supabase/functions/`. |
| `GSK-FIREBASE-001` | Regras do Firebase abertas | HIGH | `firestore.rules` / `storage.rules`: `allow read, write: if true` (ou `allow write: if true`); `database.rules.json`: `".read": true` ou `".write": true` em qualquer nível. | Regras com condição (`request.auth != null`). |
| `GSK-CORS-001` | CORS com origem curinga | MODERATE (HIGH se combinado com credenciais) | `Access-Control-Allow-Origin` igual a `*` em `next.config.*` headers, `vercel.json`, handlers de API; `cors({ origin: "*" })` ou `cors()` sem opções em servidor Express/Hono; `credentials: true` junto com origem curinga ou refletida eleva para HIGH. | Rotas explicitamente públicas marcadas por comentário `// gateseeker: public-cors` (mecanismo de supressão, ver 3.4). |
| `GSK-ENV-001` | Arquivo `.env` com segredos não ignorado pelo git | MODERATE | Existe `.env`, `.env.local`, `.env.production` ou similar na raiz, contendo ao menos uma variável não pública, e `.gitignore` não cobre o arquivo. | `.env.example`, `.env.sample`, `.env.template`; arquivos só com variáveis públicas. |
| `GSK-BUILD-001` | Erros de tipo ou lint ignorados no build | LOW | `next.config.*` com `typescript.ignoreBuildErrors: true` ou `eslint.ignoreDuringBuilds: true`. Muito comum em código gerado por Lovable e v0. | Nenhum; é informativo. |

**Fora desta sprint, com justificativa:**

- Rota de API sem verificação de autenticação. Exigiria análise de fluxo para distinguir rotas públicas de privadas; a taxa de falsos positivos seria alta. Candidata à Sprint 2 com abordagem restrita (rotas que tocam `service_role` ou escrevem no banco sem ler `auth`).
- SQL injection e XSS por análise de dados. Requer análise de fluxo (taint). Fora do alcance determinístico simples.
- Qualquer regra para PHP, Python ou outros ecossistemas.

### 3.3. Integração com o modelo e o relatório

- `Finding.kind = "insecure-pattern"`, `subject = "<caminho relativo>:<linha>"`, `evidence` contém `ruleId`, `fileClass`, `snippet` (linha sanitizada e, para segredos, redigida), `matchedPattern` (nome, nunca o regex bruto se isso ajudar um atacante a evadir; decisão: publicar o nome e documentar os padrões no repositório, já que é open source).
- `source = { name: "gateseeker-rules", version: <versão do pacote>, queriedAt }`.
- `severity.tier` vem da regra; `severity.declared` é `null`; `cvss` é `[]`.
- `priority` e `rationale` vêm da mesma `decidePriority` da Sprint 0, com `fixAvailable: true` (toda regra tem ação).
- O relatório ganha a seção `patterns: { filesScanned, filesSkipped, bytesScanned, rulesRun, suppressions }`.
- O gate: `--patterns warn|gate` (padrão `warn`). Em `warn`, achados de padrão não afetam o veredito nem o código de saída, mas aparecem no resumo. Em `gate`, entram na regra normal de `--fail-on`.

### 3.4. Supressão auditável

Comentário na linha ou na anterior: `// gateseeker-ignore GSK-CORS-001 motivo obrigatório`. A supressão aparece no relatório em `patterns.suppressions` com arquivo, linha, regra e motivo. Supressão sem motivo é ignorada e gera aviso. Não existe supressão global por arquivo de configuração nesta sprint.

### 3.5. CLI

- `gateseeker scan <caminho>`: se `<caminho>` é um `package-lock.json`, comportamento da Sprint 0. Se é uma pasta, roda padrões e, se houver `package-lock.json` na raiz, roda dependências também.
- `--only deps|patterns` restringe a análise.
- `--patterns warn|gate` (padrão `warn`).
- `--max-files`, `--max-file-size` para os limites do walker.
- Sem `package-lock.json` na pasta: a seção de dependências fica `not-analyzed`, isso aparece em `limitations`, e o veredito é calculado só com o que foi analisado. Isso **não** é `incomplete`, pois nenhuma consulta falhou; é ausência declarada de análise.
- Saída de texto: achados de padrão listados com `caminho:linha`, snippet redigido e ação, no mesmo bloco ordenado por prioridade dos achados de dependência.

### 3.6. Validação em projetos reais

Após as regras passarem nos testes, validar contra 5 repositórios públicos reais construídos com Lovable, v0, Bolt ou similares, escolhidos pelo PO ou propostos pelo engenheiro para aprovação.

- Clonar é leitura de repositório público e não configura integração com GitHub, mas **requer aprovação explícita do PO** por envolver código de terceiros na máquina.
- Para cada projeto, registrar em `docs/VALIDATION_SPRINT_1.md`: achados por regra, classificação manual de cada achado como verdadeiro ou falso positivo, e ajuste feito na regra quando houver falso positivo.
- Regra com precisão abaixo de 90% nessa amostra fica marcada `experimental` no relatório e não entra em modo `gate` mesmo quando solicitado.
- Nenhum segredo real encontrado nesses projetos é registrado em documento algum; apenas "segredo do tipo X em arquivo Y".

## 4. Testes obrigatórios

Fixtures em `fixtures/projects/<nome>/`, cada uma um mini projeto com `README` de uma linha. Para cada regra, no mínimo:

1. Um caso positivo que deve gerar exatamente o achado esperado (regra, arquivo, linha, prioridade).
2. Um caso negativo plausível que não deve gerar achado (a coluna "falso positivo evitado" da tabela).
3. Um caso de supressão com motivo e um sem motivo.

Fixtures transversais:

4. Projeto com `node_modules/` contendo um segredo de formato conhecido: não deve ser reportado.
5. Projeto acima do limite de arquivos e arquivo acima do limite de tamanho: erro controlado, código 3.
6. Arquivo binário com bytes que casam com um padrão: pulado, não reportado.
7. Pasta com `package-lock.json` vulnerável (reusar fixture lodash) e padrão inseguro: relatório contém ambos os `kind`, e o veredito em `--patterns warn` depende só das dependências; em `--patterns gate`, de ambos.
8. Pasta sem `package-lock.json`: dependências `not-analyzed`, veredito calculado só com padrões, não `incomplete`.
9. Segredo em fixture é sempre sintético com formato válido mas valor inventado (ex.: `sk_live_` seguido de caracteres gerados), e o teste verifica que o relatório **não** contém o valor completo.

Os testes verificam valores específicos: id da regra, caminho, linha, prioridade, rationale, contagens de `patterns`, e ausência do segredo no JSON serializado.

## 5. Segurança adicional

Além da seção 5 da Sprint 0:

- O walker não segue symlinks e não sai da pasta raiz informada (verificação de caminho resolvido).
- Nenhum conteúdo de arquivo é interpolado em comando, regex dinâmico ou caminho.
- Regexes de detecção são revisadas contra ReDoS: sem quantificadores aninhados ambíguos; teste de tempo com entrada adversarial de 1 MB por regra, limite de 200 ms.
- Segredos redigidos em toda saída; teste automatizado garante isso.
- `docs/THREAT_MODEL.md` ganha a superfície "sistema de arquivos do projeto analisado" com as mitigações e testes correspondentes.

## 6. Critérios de aceite

- As 8 regras implementadas, cada uma com fixtures positiva, negativa e de supressão, e todos os testes passando.
- `gateseeker scan <pasta>` funciona em pasta com e sem `package-lock.json`, em `--only deps`, `--only patterns`, `--patterns warn` e `--patterns gate`, com os códigos de saída documentados.
- Nenhum segredo completo aparece em relatório, terminal ou fixture.
- Limites do walker testados nos dois lados.
- Teste de ReDoS para cada regex.
- Validação em 5 projetos reais registrada em `docs/VALIDATION_SPRINT_1.md`, com precisão por regra. Regras abaixo de 90% marcadas `experimental`.
- `README.md`, `docs/ARCHITECTURE.md` e `docs/THREAT_MODEL.md` atualizados e correspondendo ao código.
- CI verde.

## 7. Decisões que precisam do PO antes de começar

1. Aprovação deste escopo.
2. Aprovação para clonar repositórios públicos de terceiros para a validação (seção 3.6), e se o PO quer indicar os 5 projetos ou prefere que o engenheiro proponha uma lista.
3. Confirmação de que padrões de detecção ficam públicos no repositório open source (recomendado: sim; segurança por obscuridade não é diferencial e a auditabilidade é).

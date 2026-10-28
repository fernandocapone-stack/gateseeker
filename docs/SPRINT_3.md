# Gateseeker — Sprint 3: GitHub Action oficial com gate configurável

> Status: **aprovada pelo PO em 2026-10-27** com todas as recomendações (repositório público, npm `1.0.0-beta.1` com proveniência, comentário e SARIF ligados, incompleto bloqueia). Publicado em 2026-10-28: repositório público, `gateseeker@1.0.0-beta.6` no npm com proveniência verificável (`npm audit signatures`), preparado pelo CI e aprovado pelo PO com 2FA; a `1.0.0-beta.1` saiu antes da máquina do PO sem proveniência (ver `docs/RELEASE.md`). Validação externa concluída em 2026-10-28: dois repositórios públicos de teste, seis execuções, seis resultados esperados (`docs/VALIDATION_SPRINT_3.md`); dois defeitos de texto corrigidos na main. Sprint encerrada.
> Última atualização: 2026-10-27

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano, que não é desenvolvedor: apresente decisões em linguagem simples. As regras de trabalho, a stack e os controles de segurança das sprints anteriores continuam valendo.

## 1. Objetivo da sprint

Transformar o Gateseeker de uma ferramenta que a pessoa roda na própria máquina em um **portão que roda sozinho em cada pull request e bloqueia o que não deve passar**. É o terceiro pilar do posicionamento ("gate, não relatório") e o primeiro ponto de contato de um usuário externo com o produto: alguém que nunca instalou nada adiciona três linhas num workflow e passa a ter o scanner no CI.

Entregas:

1. **Action oficial** usável por qualquer repositório com `uses: gateseeker-dev/gateseeker@v0`, com entradas para caminho, limiar, modos de aviso ou bloqueio, baseline automática e saídas para outros passos.
2. **Resumo legível no próprio pull request**: o resumo do job do GitHub e, opcionalmente, um comentário fixo no PR com os achados priorizados e a ação de cada um.
3. **Saída SARIF** para o painel de segurança do GitHub (code scanning), para que os achados apareçam onde o desenvolvedor já olha.
4. **Primeira publicação pública**: pacote `gateseeker` no npm com proveniência assinada pelo GitHub Actions, e repositório público. Sem isso a Action não pode ser usada por terceiros nem o produto ser open core de fato.
5. **Dogfooding**: o próprio repositório do Gateseeker passa a rodar a Action em cada PR.

**Hipótese a validar** (de `docs/PRODUCT.md`): alguém adota o portão. Métrica pós-sprint: 10 repositórios com a Action ativa por 30 dias. A sprint entrega a Action e a instrumentação mínima para saber se isso aconteceu, sem telemetria no produto (seção 2, item 5).

## 2. Princípios específicos

1. **O gate decide pelo código de saída que já existe.** Pass 0, fail 1, incompleto 2, erro de uso 3. A Action não inventa uma segunda lógica; ela mapeia esses códigos para o resultado do job.
2. **Incompleto bloqueia por padrão.** É o princípio do produto desde a Sprint 0: uma consulta que falhou nunca vira "limpo". A entrada `allow-incomplete` existe para quem aceita o risco conscientemente, e o resumo diz em letras grandes que a análise não terminou.
3. **A Action pode rodar git; o scanner continua sem rodar.** O scanner nunca executa git. A Action, que roda dentro do workflow do usuário e já tem o checkout, obtém o lockfile da branch de base com `git show` e o passa como `--baseline`. A separação fica explícita.
4. **Versão fixada.** A Action executa exatamente a versão do pacote npm correspondente à sua própria tag. Nada de `latest`.
5. **Sem telemetria.** O produto não liga para casa. A adoção é medida pelo que o GitHub mostra publicamente (dependents da Action, downloads do npm) e pelo que usuários relatarem.
6. **Permissões mínimas.** O job precisa só de `contents: read`. O comentário no PR precisa de `pull-requests: write` e o SARIF de `security-events: write`; os dois são opcionais e documentados.

## 3. Escopo

### 3.1. Action composta (`action.yml` na raiz do repositório)

Entradas:

| Entrada | Padrão | Significado |
|---|---|---|
| `path` | `.` | Pasta do projeto a analisar. |
| `fail-on` | `P2` | Prioridade mínima que falha o gate. |
| `patterns` | `warn` | `warn` ou `gate` para as regras de código. |
| `supply-chain` | `warn` | `warn` ou `gate` para as regras estruturais. |
| `only` | vazio | `deps` ou `patterns` para rodar uma análise só. |
| `baseline-ref` | base do PR (`github.base_ref`) ou vazio | Referência git de onde obter o lockfile anterior; vazio desliga a comparação. |
| `allow-incomplete` | `false` | Se `true`, veredito incompleto não falha o job (continua marcado no resumo). |
| `comment` | `true` em PRs | Publica ou atualiza um comentário fixo no PR com o resumo. |
| `sarif` | `true` | Gera SARIF e envia ao code scanning quando a permissão existir. |
| `advisories` | vazio | Caminho de um conjunto de advisories local, para quem mantém o próprio. |
| `max-size`, `max-deps`, `max-files`, `max-file-size`, `timeout`, `concurrency` | padrões da CLI | Repasse direto. |

Saídas: `verdict`, `findings`, `p1`, `p2`, `p3`, `p4`, `report` (caminho do JSON), `sarif` (caminho).

Passos da Action: `setup-node` fixado em Node 24; `npx --yes gateseeker@<versão fixada>`; se `baseline-ref` estiver definido e o lockfile existir nessa referência, `git show <ref>:<lockfile>` para um arquivo temporário; execução do scanner com `--format json --output`; geração do resumo do job; comentário no PR; SARIF; mapeamento do código de saída.

### 3.2. Saídas novas na CLI

- `--format sarif`: cada achado vira um `result` com `ruleId` (id do GSK, da advisory ou do OSV), nível por prioridade (P1 e P2 `error`, P3 `warning`, P4 `note`), localização (arquivo e linha para padrões; o lockfile e a linha do pacote para dependências e supply chain), mensagem com a ação, e `partialFingerprints` estáveis para o GitHub deduplicar entre execuções. As regras (`rules`) incluem título, descrição curta e link para o README.
- `--format summary`: Markdown curto para o resumo do job e para o comentário do PR: veredito, contagens por prioridade e por tipo, tabela com até 20 achados ordenados por prioridade (assunto, id, gravidade, ação em uma linha), e a lista de limitações colapsada. O JSON continua sendo a fonte completa.

### 3.3. Resumo do job e comentário no PR

- O resumo do job (`$GITHUB_STEP_SUMMARY`) recebe o Markdown de `--format summary`.
- O comentário no PR é um único comentário marcado com um identificador oculto, atualizado a cada execução em vez de criar um novo. Precisa de `pull-requests: write`; sem a permissão, a Action registra um aviso e segue. Implementado com a API REST via `GITHUB_TOKEN`, sem ação de terceiros.
- Linguagem do produto preservada: nunca "seguro"; sempre "nenhuma vulnerabilidade conhecida foi encontrada nas fontes consultadas".

### 3.4. Publicação

- `package.json` passa a `1.0.0-beta.1` (o produto sai do zero-ponto-um porque passa a ser instalado por terceiros; ainda beta).
- Workflow `release.yml`: disparado por tag `v*`; roda `pnpm check` e `pnpm test:e2e`; publica no npm com `--provenance` via OIDC (sem token de npm guardado no repositório; exige o pacote configurado para trusted publishing); cria a release no GitHub com as notas; move a tag flutuante `v0` (ou `v1` quando sair da beta) para a release.
- `npm pack --dry-run` verificado em CI para garantir que só `dist/`, `ui/dist/`, `advisories/LICENSE`, `README.md` e `LICENSE` entram no pacote; nenhuma fixture, nenhum teste, nenhum feed gravado.
- Repositório público: `README` recebe uma seção "Use in GitHub Actions" com o exemplo de três linhas e a tabela de entradas; `SECURITY.md` com o canal para reportar vulnerabilidades do próprio Gateseeker; `CONTRIBUTING.md` curto apontando para `CLAUDE.md`/`AGENTS.md` e para o processo de advisories.

### 3.5. Dogfooding e validação

- `ci.yml` do próprio repositório ganha um job que usa a Action local (`uses: ./`) em cada PR, com `patterns: gate` e `supply-chain: gate`, sobre `fixtures/projects/clean-vite` (deve passar) e sobre `fixtures/projects/vibe-next-supabase` com `allow-incomplete` e `continue-on-error` (deve falhar e mostrar os achados no resumo).
- Validação externa: dois repositórios de teste públicos criados pelo PO (ou com aprovação dele), um JavaScript e um PHP, cada um com um PR que troca uma dependência por uma versão vulnerável conhecida e um PR com atualização limpa; verifica-se que o primeiro é bloqueado com o comentário e o SARIF corretos e o segundo passa. Resultado em `docs/VALIDATION_SPRINT_3.md`.

## 4. Testes obrigatórios

1. Renderizador SARIF: achados dos três tipos produzem `results` válidos contra o esquema SARIF 2.1.0 (validação por Zod com o subconjunto usado); fingerprints estáveis entre duas execuções com o mesmo relatório; níveis por prioridade.
2. Renderizador de resumo: contagens, tabela limitada a 20, limitações presentes, wording do produto, sanitização de nomes de pacote.
3. CLI: `--format sarif` e `--format summary` com fixtures existentes; `--output` continua gravando JSON independentemente do formato de saída.
4. Action: teste de workflow em CI (job de dogfooding) cobrindo pass, fail e incompleto com `allow-incomplete`; verificação de que `baseline-ref` encontra o lockfile da base e de que a ausência dele é declarada no resumo.
5. Comentário no PR: lógica de criar-ou-atualizar testada contra um servidor HTTP local que simula a API do GitHub (sem rede nos testes unitários).
6. Empacotamento: teste que executa `npm pack --dry-run` e confere a lista de arquivos.

## 5. Segurança adicional

- A Action não usa ações de terceiros além de `actions/checkout` e `actions/setup-node`, fixadas por versão principal.
- O comentário no PR escapa Markdown vindo de nomes de pacote e resumos de advisories; nenhum link clicável é construído a partir de dados do projeto analisado.
- A publicação usa proveniência: qualquer pessoa pode verificar que o pacote no npm foi construído pelo workflow deste repositório a partir de um commit específico. Para uma ferramenta de supply chain, isso é obrigatório.
- `docs/THREAT_MODEL.md` ganha as superfícies "workflow do usuário" (entradas da Action tratadas como não confiáveis, caminhos validados) e "publicação" (release só por tag assinada pelo mantenedor, proveniência, lista de arquivos auditada).

## 6. Critérios de aceite

- A Action funciona a partir de outro repositório com `uses: gateseeker-dev/gateseeker@v0` e as entradas documentadas.
- Pass, fail e incompleto mapeados corretamente, com `allow-incomplete` respeitado.
- Baseline automática a partir da branch de base em PRs.
- Resumo do job e comentário fixo no PR funcionando; SARIF aceito pelo code scanning.
- Pacote publicado no npm com proveniência; `npm pack` contendo só o esperado.
- Dogfooding ativo no próprio repositório; validação externa registrada.
- README, ARCHITECTURE, THREAT_MODEL e SECURITY atualizados; CI verde.

## 7. Fora de escopo

Interface web hospedada, histórico entre execuções, contas e times (a 2a-UI continua sendo a única interface, local), suporte a GitLab ou Bitbucket, ação de correção automática, telemetria.

## 8. Decisões que precisam do PO antes de começar

1. **Aprovação deste escopo.**
2. **Tornar o repositório público.** Necessário para a Action ser usada por terceiros e para o open core decidido na Sprint 0. Antes de virar público: revisar o histórico por qualquer dado sensível (fiz isso a cada commit, mas a revisão final é sua), decidir o nome de exibição e a descrição, e lembrar que a tagline provisória continua provisória.
3. **Publicar no npm como `gateseeker`**, versão `1.0.0-beta.1`, com proveniência. Exige que você crie o pacote no npm (ou me autorize a criar na sua conta npm, que precisa existir) e configure o trusted publishing para este repositório; eu preparo o passo a passo.
4. **Comentário no PR ligado por padrão** em pull requests (recomendo sim: é onde o desenvolvedor vê) e **SARIF ligado por padrão** (recomendo sim).
5. **Incompleto bloqueia por padrão** (recomendo sim, pelo princípio do produto; `allow-incomplete` fica para quem decidir o contrário).
6. **Dois repositórios públicos de teste** para a validação externa, criados na sua conta ou com sua aprovação.

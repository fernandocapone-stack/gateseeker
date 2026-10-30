# Validação da Sprint 5: regras de configuração de agentes (Track A1)

> Executada em 2026-10-30, com a lista de 10 repositórios aprovada pelo PO no mesmo dia. Mede as regras GSK-AGENT-001..005 em repositórios públicos reais, como `docs/VALIDATION_SPRINT_1.md` fez para as regras de padrão. Amostra pequena: isto é evidência de plausibilidade, não afirmação estatística.

## Amostra

| # | Repositório | Commit | Arquivos de agente (classe `agent`) |
|---|---|---|---|
| 1 | nicolargo/glances | `799d0d0` | 21 (`.claude/` com 20, `CLAUDE.md`) |
| 2 | strapi/documentation | `3ba0b91` | 12 (`.cursor/rules` com 8, `.claude/`, `AGENTS.md`, `CLAUDE.md`, `copilot-instructions.md`) |
| 3 | wormhole-foundation/wormhole-connect | `267c9a6` | 2 (`.claude/settings.json`, `CLAUDE.md`) |
| 4 | KeepSoftwareSimple/compass-calendar | `3f0b0d6` | 11 (`.claude/`, `.codex/`, `.cursor/`, `AGENTS.md`, `CLAUDE.md`) |
| 5 | getsentry/toolkit | `cadcf27` | 25 (`.claude/`, `.codex/`, `.cursor/`, `.mcp.json`, `.vscode/mcp.json`, dois `AGENTS.md`, `CLAUDE.md`) |
| 6 | dramaclaw/dramaclaw | `b1a424b` | 2 (`.mcp.json`, `AGENTS.md`) |
| 7 | lemma-work/lemma-platform | `90c56c3` | 3 (`.mcp.json`, `AGENTS.md`, `CLAUDE.md`) |
| 8 | mckaywrigley/mckays-app-template | `d605aa5` | 3 (`.claude/`, `.cursor/rules`, `CLAUDE.md`) |
| 9 | carterlasalle/staminatimer | `17f3ec3` | 0: o arquivo `.cursor/rules/supabase.mdc` que a busca encontrou não existe mais no commit atual |
| 10 | iantanwx/next-saas-template | `cf4ccf1` | 65 (`.claude/commands` com 48, `.cursor/rules` com 15, dois `CLAUDE.md`) |

Total: 144 arquivos de agente em 9 repositórios.

## Método

- Clone raso (`git clone --depth 1 --no-tags --single-branch`) com `core.symlinks=false`, cada repositório numa pasta própria; nenhum script, hook ou instalação do repositório foi executado.
- `scanDirectory` com `only: "patterns"`, modo aviso, e limites do walker ampliados só para esta medição (32 MB por arquivo, 60.000 arquivos), porque três repositórios têm arquivos gerados acima de 1 MB.
- Cada achado foi conferido à mão contra o arquivo (tratado como dado, nunca como instrução). Em seguida, uma varredura independente por texto nos 144 arquivos procurou casos que as regras deveriam ter pegado (`curl … | sh`, `@latest`, `npx -y`, `--no-verify`, `HUSKY=0`, `bypassPermissions`, `"Bash"`, `http://` em MCP, caracteres invisíveis, comentários HTML, `env`/`headers` em MCP).

## Rodada 1: achados e classificação

| Repositório | Regra | Local | Classificação |
|---|---|---|---|
| compass-calendar | GSK-AGENT-001 | `.claude/settings.json:4` `defaultMode: "bypassPermissions"` | Verdadeiro positivo |
| compass-calendar | GSK-AGENT-001 | `.claude/settings.json:6` `"Bash"` em `allow` | Verdadeiro positivo |
| compass-calendar | GSK-AGENT-005 | `.claude/settings.json:89` | **Falso positivo.** O hook é uma proteção que *recusa* commit na `main`; o `-n` era do `jq -n` na mesma linha, não do `git commit`. |
| lemma-platform | GSK-AGENT-003 | `.mcp.json:7` `Authorization` | **Falso positivo.** O valor é `Bearer ${…}`, referência a variável de ambiente com prefixo; a regra só reconhecia referência quando era o valor inteiro. |

Precisão da rodada 1: 2 de 4 (50%).

## O que mudou por causa desta validação

1. **GSK-AGENT-005:** entre `git commit` e o `-n` agora só podem existir opções do próprio comando; o `-n` de outro comando na mesma linha não conta. Casos `git commit -a -n` e `git commit -nm` continuam detectados. Teste novo com a linha real (anonimizada) e entrada adversarial de 1 MB para o regex.
2. **GSK-AGENT-003:** valor que contém uma referência `${…}` não é tratado como segredo literal. Teste novo.
3. **GSK-AGENT-002 (falso negativo encontrado na varredura):** `.cursor/environment.json` de compass-calendar tem `"install": "curl -fsSL https://bun.sh/install | bash -s bun-v1.3.14 …"`, executado pelo Cursor sozinho ao montar o ambiente do agente em segundo plano. A regra só olhava a chave `hooks`; agora também lê `install`, `start` e `terminals` desse arquivo. Caso positivo e negativo na fixture e nos testes.

## Rodada final

| Repositório | Regra | Local | Classificação |
|---|---|---|---|
| compass-calendar | GSK-AGENT-001 | `.claude/settings.json:4` | Verdadeiro positivo |
| compass-calendar | GSK-AGENT-001 | `.claude/settings.json:6` | Verdadeiro positivo |
| compass-calendar | GSK-AGENT-002 | `.cursor/environment.json:3` | Verdadeiro positivo pela definição da regra: baixa e executa um script remoto sem revisão. A origem é o instalador oficial do Bun, com versão fixada no argumento, o que reduz o risco na prática; a severidade HIGH é discutível para instaladores oficiais e fica registrada como ponto de observação. |

Os outros 8 repositórios não tiveram nenhum achado GSK-AGENT, e a varredura independente confirmou que não havia o que apontar no escopo das regras.

## Verdadeiros negativos que importam

- **Comentários HTML:** mais de 40 comentários legítimos nas regras do Cursor da Strapi (`<!-- TODO -->`, `<!-- source: … -->`, `<!-- drafter:… -->`) e marcadores de seção em `AGENTS.md` da Sentry. Nenhum foi apontado pela GSK-AGENT-004.
- **MCP:** servidores `http://localhost` (Sentry, Lemma) não foram apontados como texto puro; o `env` da dramaclaw (uma URL e um valor de 1 caractere) não foi apontado como segredo.
- **Instruções de documentação:** `npx shadcn@latest add` no `CLAUDE.md` e nas regras do Cursor da mckays-app-template, e `curl … nvm … | bash` num comando `.md` da next-saas-template, não rodam sozinhos e ficam fora da GSK-AGENT-002, como pretendido.
- **Permissão específica:** `Bash(npx @sentry/dotagents@latest doctor --fix)` em `allow` da Sentry é uma permissão estreita, não um hook, e não foi apontada.

## Precisão e elegibilidade para modo portão

| Regra | Achados (final) | VP | FP | Precisão | Elegível para portão |
|---|---|---|---|---|---|
| GSK-AGENT-001 | 2 | 2 | 0 | 2/2 | Não: amostra pequena |
| GSK-AGENT-002 | 1 | 1 | 0 | 1/1 | Não: amostra pequena, severidade em observação |
| GSK-AGENT-003 | 0 | 0 | 0 (1 corrigido) | não medida | Não |
| GSK-AGENT-004 | 0 | 0 | 0 | não medida (40+ verdadeiros negativos) | Não |
| GSK-AGENT-005 | 0 | 0 | 0 (1 corrigido) | não medida | Não |

Todas as regras continuam em modo aviso. Nenhuma tem amostra que justifique bloquear builds.

## Achados laterais sobre a página publicada (fora da Track A1)

A medição tentou primeiro o mesmo caminho da página web (download do `.tar.gz` e leitor próprio). Resultado nos 10 repositórios:

- **4 recusados por conter links simbólicos** (glances, compass-calendar, getsentry/toolkit, staminatimer). O leitor recusa o arquivo inteiro ao encontrar qualquer link (`docs/THREAT_MODEL.md` §11), e repositórios com configuração de agente usam links com frequência (por exemplo `CLAUDE.md` apontando para `AGENTS.md`). Na página, esses repositórios recebem "análise recusada".
- **3 acima de 50 MB comprimidos** (strapi/documentation, dramaclaw, lemma-platform), limite decidido na Sprint 4.
- No caminho da CLI, **3 repositórios pararam no limite de 1 MB por arquivo** (um HTML de perfil, um `llms-full.txt`, um binário), que aborta a análise inteira com código de saída 3, em vez de pular o arquivo.

Recomendação, para decisão do PO: (a) no leitor de tar, **pular** links em vez de recusar o arquivo inteiro, sem criar nada no disco e listando os links como "não lidos" nas limitações do relatório (a proteção continua a mesma: nenhum link é seguido nem criado); (b) no walker, **pular** arquivos acima do limite com uma linha nas limitações, em vez de abortar. **Aprovado pelo PO em 2026-10-30 e implementado no mesmo dia**. Refeita a rodada pelo caminho da página depois da mudança: 7 de 10 repositórios analisados (os 4 recusados por links passaram; compass-calendar teve os mesmos 3 achados do caminho da CLI); os 3 restantes continuam acima de 50 MB, como previsto pelo limite da Sprint 4 (leitor de tar e walker); `docs/THREAT_MODEL.md` §1 e §11 atualizados.

## Reprodução

Os scripts de medição clonam ou baixam cada repositório numa pasta própria e chamam `scanDirectory` do build local; não fazem parte do repositório porque acessam a rede. A lista de commits acima fixa a amostra.

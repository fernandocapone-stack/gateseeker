# Gateseeker — Sprint 5: do achado à correção, mais a Track A1 (configuração de agentes)

> Status: **aprovada pelo PO em 2026-10-29**, com a decisão 5 do roadmap: pnpm e Yarn **não** contam como ecossistema novo, então o §3.4 entra completo (parsers de `pnpm-lock.yaml` e `yarn.lock`). A ordem (Sprint 5 antes da 6) e a Track A1 foram aprovadas em 2026-10-28. Pendente antes do passo 4: a lista dos 10 repositórios com configuração de agente (§8.3).
> Última atualização: 2026-10-29. **Passos 1 a 3 implementados** (branch `sprint5/fix-guidance`). Passo 3: no relatório da web, cada achado expandido mostra o que pode acontecer, os passos, o prompt com botão de copiar e "Accept the risk" (motivo obrigatório; comentário na sintaxe do tipo de arquivo, recusado para JSON); rótulos de prioridade no terminal, no resumo da Action e no PDF (que também ganhou impacto e passos). Passo 4 (Track A1) implementado em 2026-10-30, medido em 2026-10-30 nos 10 repositórios aprovados (`docs/VALIDATION_SPRINT_5.md`: precisão final 3/3, dois falsos positivos e um falso negativo corrigidos; todas em modo aviso): classe de arquivo `agent`, regras GSK-AGENT-001..005 em modo aviso, fixture `agent-config` com caso positivo, negativo e suprimido por regra, teste de tempo de ReDoS e textos de correção; GSK-AGENT-002 e 004 não têm prompt de IA, porque um hook malicioso roda enquanto o agente trabalha no repositório e um agente que limpa um arquivo envenenado lê a instrução escondida. Passos 1 e 2: campos `impact`, `manualSteps` e `aiPrompt` com textos para as oito regras de padrão, para atualização de dependência e para supply chain (sem prompt), mostrados no terminal; veredito `incomplete` para lockfile não suportado. Dois ajustes ao texto abaixo, decididos na implementação: os textos das regras ficam num registro por regra em `src/rules/remediation/patterns.ts` (um arquivo só, mais fácil de revisar que oito); e o teste 2 proíbe as instruções de silenciar (`gateseeker-ignore`, `--no-verify`) em vez de palavras soltas como "disable", porque o parágrafo final de todo prompt precisa dizer "não desligue verificações".

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano, que não é desenvolvedor: apresente decisões em linguagem simples. As regras de trabalho, a stack e os controles de segurança das sprints anteriores continuam valendo. Esta sprint não traz serviço hospedado novo nem dependência nova.

## 1. Objetivo da sprint

Hoje o Gateseeker diz **o que** está errado e por que importa. A Sprint 5 faz o relatório dizer **como corrigir, do jeito que o nosso público corrige**: pedindo para o Cursor, o Lovable ou o Claude Code fazer. Um P1 que a pessoa não sabe corrigir é um P1 ignorado, exatamente como os alertas do Dependabot que dissemos que ela ignora.

Em paralelo, a **Track A1** acrescenta regras para a configuração dos agentes de código (`.claude/`, `.mcp.json`, `.cursor/`, `AGENTS.md`), uma superfície de risco que nenhum concorrente acompanhado verifica.

Entregas:

1. **"Corrigir com sua ferramenta de IA"**: para cada regra, um prompt de correção pronto para copiar, escrito por nós e testado como as regras. Nenhum modelo gera esse texto.
2. **Correção manual curta** para quem não usa ferramenta de IA, e **uma frase de impacto** ("o que pode acontecer") por regra.
3. **Aceitar o risco**: um botão que monta a linha `gateseeker-ignore` com o motivo, para colar no código. A decisão fica no repositório, revisável no PR, sem estado no servidor.
4. **Track A1**: até cinco regras `GSK-AGENT-*` em modo aviso, com fixtures e precisão medida antes de qualquer uma poder bloquear.
5. **Condicional à decisão 5**: leitura de `pnpm-lock.yaml` e `yarn.lock`. Sem a decisão, a sprint entrega só o aviso explícito de "lockfile não suportado".

**Hipótese a validar:** as pessoas corrigem mais quando a correção está a um colar de distância. Métrica: entre quem analisa o mesmo repositório duas vezes, pelo menos 30% têm menos achados P1+P2 na segunda análise.

## 2. Princípios específicos

1. **O texto de correção é conclusão de regra, não opinião de modelo.** Ele mora na camada de regras do `Finding` (`remediation`), é determinístico, versionado e testado. A camada de explicação por IA continua reservada e `null`.
2. **O prompt descreve o problema com fatos do achado e nunca copia conteúdo não confiável sem tratamento.** Caminho de arquivo e linha entram; trecho de código não entra (pode conter segredo, mesmo redigido, ou texto feito para manipular a ferramenta de IA do usuário). Nomes de arquivo e de pacote passam por `sanitize()` e por um filtro de caracteres antes de entrar no prompt.
3. **O prompt nunca pede para desligar a verificação.** Nenhum template sugere `gateseeker-ignore`, `--no-verify`, remover o teste ou baixar o nível do portão; o caminho de aceitar o risco é separado e explícito (entrega 3).
4. **Regra de agente segue as mesmas regras de qualquer regra** (regra 11 do `CLAUDE.md`): fixtures positiva, negativa e de supressão, teste de tempo de ReDoS, modo aviso por padrão, precisão medida em repositórios reais antes de virar portão.
5. **Linguagem sem alarme.** Achado de configuração descreve o que a configuração permite ("qualquer comando que o agente decidir rodar executa sem te perguntar"); nunca afirma que houve ataque.

## 3. Escopo

### 3.1. Contrato do `Finding` (aditivo)

`remediation` ganha campos opcionais; os existentes não mudam, então SARIF, Action e CLI continuam compatíveis:

```
remediation
  fixedVersions   (existente)
  action          (existente) uma frase
  impact          nova: o que pode acontecer, uma frase em linguagem simples
  manualSteps     nova: 1 a 4 passos curtos
  aiPrompt        nova: texto pronto para colar na ferramenta de IA
```

- Templates em `src/rules/remediation/` (um arquivo por regra, como `patterns/rules/`), preenchidos só com campos do achado: id da regra, arquivo, linha, nome da variável ou do pacote, versão corrigida.
- Achados de dependência ganham o prompt genérico de atualização ("atualize `<pacote>` de `<versão>` para `<versão corrigida>` e rode os testes"), só quando a fonte informa uma versão corrigida.
- Achados de supply chain (`GSK-SC-*` e feed curado) ganham passos manuais, sem prompt de IA: investigar um pacote comprometido não é tarefa para delegar a um agente.
- O JSON da CLI inclui os campos novos; o texto do terminal mostra `impact` e `manualSteps`, não o prompt (que é longo). `--format json` e a web mostram o prompt.

### 3.2. Relatório na web

- Cada achado expandido mostra: o que pode acontecer, como corrigir (passos) e o bloco "Corrigir com IA", com botão de copiar e o nome das ferramentas para as quais o texto foi testado.
- **Aceitar o risco**: pede um motivo (obrigatório, até 200 caracteres), monta `// gateseeker-ignore GSK-XXX-000 <motivo>` no formato que o motor já entende e mostra onde colar (arquivo e linha). Nada é enviado ao servidor.
- Rótulos de prioridade: a web já usa "Fix now / Fix before release / Plan a fix / Keep an eye on it"; o resumo da Action e o texto do terminal passam a mostrar o mesmo rótulo ao lado de P1–P4.

### 3.3. Track A1: regras de configuração de agentes

Classificador de arquivos ganha a classe `agent` (`.claude/settings*.json`, `.mcp.json`, `.cursor/**`, `.codex/**`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.cursorrules`). Candidatas, cada uma entra só se as fixtures e a medição justificarem:

| Regra | O que aponta | Prioridade proposta (pela tabela, sem mudá-la) |
|---|---|---|
| GSK-AGENT-001 | Permissão irrestrita de comandos (`Bash(*)`, `"allow": ["*"]`, aprovação automática de tudo) | conforme a tabela de `src/rules/priority.ts` para padrão de configuração |
| GSK-AGENT-002 | Hook que baixa e executa código remoto (`curl … \| sh`, `npx <pacote>@latest`) | idem |
| GSK-AGENT-003 | Servidor MCP de origem remota ou sem versão fixa, ou com segredo escrito no arquivo em vez de variável de ambiente (o valor passa por `redactInLine`) | idem |
| GSK-AGENT-004 | Instruções escondidas em arquivo que o agente lê: caracteres Unicode invisíveis ou de direção, comentário HTML, texto codificado longo | idem |
| GSK-AGENT-005 | Rede de segurança desligada: `--no-verify` em script ou hook, teste pulado ou excluído no CI | idem |

Se alguma regra precisar de uma linha nova na tabela de prioridade, isso é mudança explícita na tabela e no `tests/priority.test.ts`, apresentada ao PO antes (regra 4 do `CLAUDE.md`).

Validação: os repositórios da Sprint 4 mais 10 repositórios públicos com `.claude/` ou `.cursor/` versionados (lista proposta ao PO antes da medição). Resultado em `docs/VALIDATION_SPRINT_5.md`.

### 3.4. Lockfiles pnpm e Yarn (depende da decisão 5)

- **Sem a decisão:** quando o repositório tem `pnpm-lock.yaml`, `yarn.lock` ou `bun.lock` e nenhum lockfile suportado, `analyses.dependencies` vira `not-supported` com o motivo, o veredito vira `incomplete` (nunca `pass`) e a página diz em uma frase o que não foi analisado.
- **Com a decisão:** parsers de `pnpm-lock.yaml` (v9) e `yarn.lock` (v1 e Berry) com Zod, limites de tamanho e de dependências iguais aos do npm, fixtures gravadas de projetos reais com proveniência no README. YAML sem dependência nova: só o subconjunto que esses lockfiles usam, com teste de ReDoS. `bun.lockb` (binário) fica fora.

## 4. Testes obrigatórios

1. Cada template de correção: snapshot do texto gerado para um achado de fixture, e teste de que caminho com caracteres de controle, quebra de linha ou crase chega neutralizado ao prompt.
2. Nenhum prompt contém `gateseeker-ignore`, `--no-verify`, "skip", "disable" ou o trecho de código do achado (teste varre todos os templates).
3. Nenhum valor de `fixtures/projects/secrets.json` aparece em `impact`, `manualSteps` ou `aiPrompt`.
4. A linha de aceitar risco gerada pela web é reconhecida pelo motor como supressão válida (teste de ida e volta com o `SUPPRESS_RE` do motor).
5. Track A1: fixtures positiva, negativa e de supressão por regra em `fixtures/projects/`, e teste de tempo de ReDoS com entrada adversarial de 1 MB.
6. Lockfile não suportado: projeto só com `pnpm-lock.yaml` dá `incomplete`, nunca `pass` (CLI, Action e web).
7. Playwright: copiar o prompt, aceitar risco com e sem motivo, achado de agente aparecendo no relatório.

## 5. Segurança adicional

- `docs/THREAT_MODEL.md` ganha a ameaça "o prompt de correção vira vetor de injeção na ferramenta de IA do usuário": mitigada por não incluir conteúdo de arquivo no prompt, filtrar nomes e testar os templates (testes 1 e 2).
- Arquivos de instrução de agente são lidos como texto, como qualquer arquivo; nenhum é interpretado ou seguido pelo Gateseeker.

## 6. Critérios de aceite

- Todo achado de padrão tem `impact`, `manualSteps` e `aiPrompt`; todo achado de dependência com versão corrigida tem prompt de atualização.
- O prompt de cada regra foi colado no Claude Code e no Cursor contra a fixture positiva e produziu a correção esperada (registro em `docs/VALIDATION_SPRINT_5.md`; teste manual, porque não automatizamos chamadas a modelos).
- Regras A1 entregues em modo aviso, com precisão medida e registrada.
- Repositório com lockfile não suportado nunca recebe `pass`.
- `pnpm check` e `pnpm test:e2e` verdes; README, ARCHITECTURE e THREAT_MODEL atualizados.

## 7. Fora de escopo

Correção automática (abrir PR com a correção), explicação gerada por IA, A2 (verificar pacotes que não existem; depende de aprovar o registro npm como fonte), A3 (hook dentro do agente), histórico no servidor e monitoramento (Sprint 6), `bun.lockb`.

## 8. Decisões que precisam do PO antes de começar

1. **Aprovação deste escopo.**
2. **Decisão 5 do roadmap:** pnpm e Yarn contam como "ecossistema novo" (regra 8 do `CLAUDE.md`)? Recomendação: não; é o mesmo registro npm e as mesmas fontes, só outro formato de arquivo. Se aprovado, entra o §3.4 completo; senão, só o aviso de não suportado.
3. **Lista dos 10 repositórios com configuração de agente** para medir a A1, proposta antes de qualquer análise.

## 9. Ordem de trabalho

1. Contrato aditivo do `Finding`, templates das oito regras de padrão e testes 1 a 3.
2. Aviso de lockfile não suportado (vale com ou sem a decisão 5).
3. Relatório na web: impacto, passos, prompt e aceitar risco; rótulos no terminal e na Action.
4. Track A1: classe `agent`, regras uma a uma com fixtures; medição; documento de validação.
5. Se aprovado: parsers de pnpm e Yarn.
6. Validação manual dos prompts nas ferramentas; README, ARCHITECTURE, THREAT_MODEL.

Os passos 1 a 3 não dependem de nenhuma decisão além da aprovação deste documento.

# Validação externa da Sprint 3: a Action em repositórios de terceiros

> Executada em 2026-10-28 com `gateseeker@1.0.0-beta.6` (npm, com proveniência) referenciada como `fernandocapone-stack/gateseeker@v1`. Critério de aceite da `docs/SPRINT_3.md`, seção 3.5: dois repositórios públicos de teste, um JavaScript e um PHP, cada um com um PR que troca uma dependência por uma versão vulnerável conhecida e um PR com atualização limpa; o primeiro deve ser bloqueado com comentário e SARIF corretos, o segundo deve passar.

## Repositórios

| | JavaScript | PHP |
|---|---|---|
| Repositório | https://github.com/fernandocapone-stack/gateseeker-test-js | https://github.com/fernandocapone-stack/gateseeker-test-php |
| Projeto base (main) | `lodash@4.18.1`, `ms@2.1.2`; lockfile v3 gerado por `npm install --package-lock-only` | `guzzlehttp/psr7@3.1.1` e suas quatro dependências; `composer.lock` montado a partir dos metadados p2 do Packagist (referências de commit, URLs e datas reais) |
| PR 1, deve bloquear | `lodash` rebaixado para `4.17.15` | `guzzlehttp/psr7` rebaixado para `1.8.0` |
| PR 2, deve passar | `ms` atualizado para `2.1.3` | `guzzlehttp/psr7` atualizado para `3.2.0` |
| Workflow | O trecho do README: `actions/checkout@v7` + `fernandocapone-stack/gateseeker@v1`, `fail-on: P2`, `patterns: warn`, `supply-chain: warn`, permissões `contents: read`, `pull-requests: write`, `security-events: write` | idem |

Os projetos foram escolhidos de propósito pequenos: o que se testa é a Action (instalação pelo npm, baseline automática, comentário, SARIF, código de saída), não o motor, já validado nas Sprints 1 e 2b. Nenhum código dos projetos é executado em nenhum momento.

Observação sobre a escolha das versões "limpas": a primeira tentativa usou `lodash@4.17.21` e `guzzlehttp/psr7@2.7.0` como base, e o scanner reprovou ambos antes de qualquer PR, por vulnerabilidades publicadas em 2026 (`CVE-2026-4800`, `CVE-2026-59882` e outras). O scanner estava certo; as versões foram trocadas pelas mais recentes. Fica como lembrete de que "a última versão que eu conhecia" não é "sem vulnerabilidades conhecidas".

## Resultado

| Execução | Esperado | Obtido | Comentário no PR | SARIF aceito pelo code scanning |
|---|---|---|---|---|
| js, push em main | pass | **success** | n/a | análise com 0 resultados |
| js, PR 1 (downgrade) | fail | **failure** | FAIL, 6 achados (3 P1, 3 P2), todos em `lodash@4.17.15`, com baseline "2 comparados, 1 alterado" | 6 alertas abertos no PR, nível error |
| js, PR 2 (atualização) | pass | **success** | PASS, 0 achados, "All 2 dependency queries completed", baseline de `origin/main` | análise com 0 resultados |
| php, push em main | pass | **success** | n/a | análise com 0 resultados |
| php, PR 1 (downgrade) | fail | **failure** | FAIL, 6 achados gated (todos P2, 5 CVEs e 1 BIT em `guzzlehttp/psr7@1.8.0`) mais `GSK-SC-002` em modo aviso | 7 alertas abertos no PR |
| php, PR 2 (atualização) | pass | **success** | PASS, 0 achados, "All 6 dependency queries completed", fontes incluem `packagist.org` | análise com 0 resultados |

Seis de seis execuções com o resultado esperado. Em todos os PRs a baseline foi obtida automaticamente da branch de base (rodapé "baseline package-lock.json from origin/main" / "baseline composer.lock from origin/main"), o comentário fixo foi criado pelo `github-actions[bot]` com o marcador oculto, e o code scanning registrou uma análise por execução na categoria `gateseeker`.

Achados reais confirmados nos PRs bloqueados (todos vindos do OSV, nenhum inventado): `GHSA-35jh-r3h4-6jhm`, `GHSA-p6mc-m468-83gw`, `GHSA-r5fr-rjxr-66jc`, `GHSA-29mw-wpgm-hmr9`, `GHSA-f23m-r3pf-42rh`, `GHSA-xxjr-mmjv-4gpg` (lodash); `GHSA-34xg-wgjx-8xph`, `GHSA-c2w2-prh8-qm98`, `GHSA-hq7v-mx3g-29hw`, `GHSA-q7rv-6hp3-vh96`, `GHSA-vm85-hxw5-5432`, `GHSA-wxmh-65f7-jcvw` (guzzlehttp/psr7). A regra estrutural `GSK-SC-002` apontou corretamente que o downgrade do psr7 introduz um arquivo de autoload (`src/functions_include.php`) que a versão base não tinha; é exatamente o tipo de mudança que a regra existe para mostrar, e em modo aviso ela não decidiu o veredito.

## Defeitos encontrados e corrigidos na main

1. **Texto da ação para pacotes PHP.** A recomendação dizia "in package.json and reinstall" para dependências do Composer. Agora diz "in composer.json and run composer update" (e, para transitivas, "or require it directly at that version"). Teste explícito em `tests/priority.test.ts`.
2. **Manchete do FAIL ambígua com achados em modo aviso.** O comentário do PR 1 em PHP dizia "6 finding(s) at priority P2 or higher" enquanto a tabela mostrava 7 P2; a diferença é o `GSK-SC-002`, em aviso, que não conta para o portão. A frase passou a "6 gated finding(s) at priority P2 or higher", com as expectativas de teste atualizadas de propósito.

Ambos saem na próxima versão publicada; a `1.0.0-beta.6` em uso nos repositórios de teste ainda mostra os textos antigos.

## Observações para decisão do PO

- **Nível SARIF de achados em modo aviso.** O `GSK-SC-002`, que não conta para o portão, aparece no code scanning como `error` porque o nível segue a prioridade (P2). Alternativa: achados em modo aviso irem como `warning`, para a aba Security refletir o que bloqueia e o que não bloqueia. Não alterado; é escolha de produto.
- **Alertas ficam no PR, não em main.** Os alertas do code scanning estão vinculados ao ref do PR; a lista padrão do repositório (ref `main`) fica vazia, como deve ser, porque main está limpa. Vale uma linha no README para quem procurar os alertas e não achar.
- **Redirecionamento do nome.** Os workflows de teste referenciam `fernandocapone-stack/gateseeker@v1`. Se o repositório for transferido para uma organização, o GitHub redireciona a referência antiga; os dois repositórios de teste serão atualizados para o novo nome na ocasião.

## Reprodução

Os lockfiles dos seis estados estão nos próprios repositórios (branches `main`, `vulnerable-downgrade` e `clean-update`). Localmente, com o pacote publicado:

```bash
npx gateseeker@1.0.0-beta.6 scan . --baseline base.lock
```

onde `base.lock` é o lockfile da branch `main` (`git show origin/main:package-lock.json > base.lock`).

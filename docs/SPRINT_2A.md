# Gateseeker — Sprint 2a: feed de inteligência curado

> Status: **proposta, aguardando aprovação do PO**. Depende da Sprint 1 concluída e validada (2026-10-27).
> Última atualização: 2026-10-27

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano. As regras de trabalho, a stack e os controles de segurança das Sprints 0 e 1 continuam valendo integralmente e não são repetidos aqui.

## 1. Objetivo da sprint

Fechar a lacuna demonstrada em 2026-10-27: cinco meses após o comprometimento dos pacotes Laravel-Lang, o OSV não tinha um único registro sobre eles. Ataques por reescrita de tag, sem versão nova e sem CVE, ficam fora das bases oficiais por meses ou para sempre, e qualquer scanner que dependa só delas diz "nenhuma vulnerabilidade conhecida".

A sprint entrega um **feed de inteligência curado**: um robô coleta fontes que publicam incidentes antes das bases oficiais e propõe registros estruturados; um humano revisa e aprova; o scanner consome apenas registros aprovados, de forma determinística, ao lado do OSV. O princípio do produto fica intacto: **o robô propõe, o humano aprova, a regra decide.**

**Hipótese a validar:** incidentes de supply chain relevantes para npm e Composer aparecem em fontes públicas semanas antes de (ou sem nunca) chegarem ao OSV, e um pipeline de coleta e triagem leve consegue transformá-los em registros acionáveis com esforço humano de minutos por registro. Métricas pós-sprint (de `docs/PRODUCT.md`): pipeline rodando sozinho por 4 semanas, ao menos 5 registros aprovados além do Laravel-Lang, ao menos 1 registro aceito upstream no OSV ou GHSA.

## 2. Princípios específicos desta sprint

1. **Nenhum registro vira achado sem aprovação humana registrada.** O scanner ignora tudo que não esteja em `status: approved` com revisor e data.
2. **Só fatos estruturados e o link.** Nunca o texto dos posts. O que fica no repositório é: título da fonte, URL, data de publicação, editor, pacotes e versões/tags/commits afetados, janela de tempo, tipo de incidente, uma linha de resumo escrita pelo revisor e a ação recomendada.
3. **Zero custo e zero modelo de linguagem nesta sprint.** A extração de pacotes candidatos é por heurística léxica; o resto é feito pelo revisor na triagem. A arquitetura deixa um ponto de extensão para um extrator por IA, desligado e não implementado, que exigirá aprovação separada.
4. **Conteúdo de feed é dado não confiável.** Parsing com limites de tamanho e tempo, sem resolução de entidades externas, sem renderização de HTML, sem seguir redirecionamentos para domínios fora da lista de fontes.
5. **O pipeline roda sem sessão interativa.** GitHub Actions agendada; se ela parar, a métrica das 4 semanas falha e isso é visível.
6. **Determinismo no scanner.** Dado o mesmo lockfile e o mesmo conjunto de registros aprovados, o resultado é idêntico.
7. **Dados abertos.** Os registros aprovados são publicados sob licença que permita reuso upstream (decisão do PO, seção 8).

## 3. Escopo

### 3.1. Formato de advisory

Um arquivo por registro em `advisories/`, em YAML (legível na revisão por PR), validado por esquema Zod em `src/intel/advisory-schema.ts`.

```yaml
id: GSK-ADV-2026-0001                 # estável, sequencial por ano
status: approved                      # proposed | approved | rejected | withdrawn
type: tag-rewrite                     # tag-rewrite | malicious-version | compromised-maintainer | typosquat | install-script-backdoor | other
severity: CRITICAL                    # mesma escala do produto
ecosystem: Packagist                  # npm | Packagist (outros entram com seus ecossistemas)
packages:
  - name: laravel-lang/lang
    affected:
      tags: ["*"]                     # tags reescritas; "*" = todas as tags existentes na janela
      commits_after: "2026-05-22T22:32:00Z"
      fixed_in: null                  # versão/commit seguro, quando houver
  - name: laravel-lang/attributes
    affected: { tags: ["*"], commits_after: "2026-05-22T22:32:00Z", fixed_in: null }
window:
  start: "2026-05-22T22:32:00Z"
  end: null
indicators:                           # fatos verificáveis, sem código do atacante
  - "autoload.files passa a incluir src/helpers.php"
summary: "Tags existentes de quatro pacotes laravel-lang reescritas com um stealer de credenciais executado no bootstrap do Composer."
remediation: "Fixar cada pacote a um commit anterior a 2026-05-22T22:32Z, reinstalar vendor, rotacionar credenciais presentes em CI e máquinas que instalaram no período."
sources:
  - { url: "https://www.stepsecurity.io/blog/laravel-lang-supply-chain-attack", publisher: "StepSecurity", title: "Laravel-Lang Supply Chain Attack", published_at: "2026-05-23" }
  - { url: "https://thehackernews.com/2026/05/laravel-lang-php-packages-compromised.html", publisher: "The Hacker News", title: "Laravel-Lang PHP Packages Compromised", published_at: "2026-05-24" }
review:
  proposed_by: "collector"            # collector | humano
  proposed_at: "2026-05-23T06:00:00Z"
  reviewed_by: "fernandocapone-stack"
  reviewed_at: "2026-10-28T00:00:00Z"
  notes: "Confirmado nas duas fontes e no repositório laravel-lang; OSV sem registro em 2026-10-27."
upstream:
  osv: null                           # id quando aceito upstream
  ghsa: null
```

Regras de validação (todas testadas): campos obrigatórios por `status`; `approved` exige `reviewed_by`, `reviewed_at` e ao menos duas fontes de editores distintos, ou uma fonte primária (repositório ou registro do próprio pacote); `summary` até 300 caracteres e `notes` até 500; URLs só `https`; nenhum campo pode conter o que pareça segredo (reuso dos padrões de `GSK-SECRET-001`); pacotes npm com nome válido; versões e faixas em semver quando `ecosystem: npm`.

O registro inaugural é o Laravel-Lang acima, proposto manualmente e aprovado pelo PO na revisão do PR.

### 3.2. Coletor

Comando `gateseeker-intel collect` em `src/intel/feed/`, executado pela Action agendada e também localmente.

- Fontes em `advisories/sources.yaml`: lista de feeds RSS/Atom com nome do editor, URL, e peso. Lista inicial proposta: StepSecurity, Socket, Aikido, Phoenix Security, Snyk blog, Wiz, The Hacker News, Sonatype, ReversingLabs, Checkmarx, feed de commits do repositório `ossf/malicious-packages`, feed de releases do `FriendsOfPHP/security-advisories`. O PO pode cortar ou acrescentar (seção 8).
- Para cada fonte: busca com timeout (10 s) e limite de tamanho (2 MB); parser RSS/Atom próprio e mínimo, sem DTD e sem entidades externas; extrai título, link, data, editor. Nada mais é guardado.
- Filtro de relevância por termos (configuráveis em `sources.yaml`): `supply chain`, `malicious`, `compromised`, `backdoor`, `typosquat`, `npm`, `composer`, `packagist`, `pypi`, `credential stealer`, `tag`. Entradas que não casam são descartadas.
- Extração heurística de pacotes candidatos a partir do título e do link: `vendor/package` (Composer), `@scope/name` e `name@x.y.z` (npm). Candidatos vão para o campo `packages` do proposto com `affected: {}` vazio; o revisor completa.
- Deduplicação por URL canônica e por hash de título normalizado em `advisories/.state/seen.json`, atualizado no mesmo PR.
- Para cada entrada nova, grava `advisories/proposed/<data>-<slug>.yaml` com `status: proposed` e `proposed_by: collector`.
- Saída: resumo em texto do que foi coletado, descartado e proposto, para o log da Action e para o corpo do PR.

### 3.3. Triagem

- A Action abre **um PR por execução** que tenha ao menos um proposto, com título `intel: N proposals (<data>)`, corpo listando título, editor, link e pacotes candidatos de cada um.
- O revisor edita o YAML no próprio PR: completa `affected`, `type`, `severity`, `summary`, `remediation`, `window`, muda `status` para `approved` ou `rejected`, preenche `review`. Aprovado move para `advisories/approved/`; rejeitado fica em `advisories/rejected/` com `notes` curto (serve de memória para não repropor).
- CI do PR: valida todos os YAML pelo esquema; falha se um `approved` não cumprir as exigências; falha se qualquer arquivo contiver padrão de segredo; falha se `summary` ou `notes` excederem o tamanho.
- Sem triagem automática de nenhum tipo. Sem fusão automática.

### 3.4. Consumo pelo scanner

- Em build, os registros `approved` são compilados para `dist/advisories.json` e embarcados no pacote. O scanner carrega esse conjunto por padrão; `--advisories <caminho>` substitui por um arquivo local (útil em testes e em organizações com feed próprio). Não há download em tempo de execução nesta sprint.
- Para cada dependência `npm` identificada (Sprint 0), o módulo `src/intel/advisories.ts` verifica correspondência exata de nome e inclusão de versão em `affected.versions` ou `affected.ranges` (semver, reusando `compareSemver`). Para `ecosystem: Packagist` não há correspondência nesta sprint porque o parser de `composer.lock` chega na 2b; o registro Laravel-Lang fica armazenado e testado pelo esquema, e passa a casar na 2b.
- Correspondência vira `Finding` com `kind: "supply-chain-anomaly"`, `source: { name: "gateseeker-advisories", queriedAt }`, `evidence` com `advisoryId`, `type`, `summary`, `window`, `indicators` e `references` com as fontes. Severidade do registro entra na matriz de prioridade; `fixAvailable` reflete `fixed_in`.
- `QueryRecord` ganha a fonte `gateseeker-advisories` ao lado de `osv.dev`; o relatório lista em `sources` a versão do conjunto de advisories (hash e data de build), e `limitations` passa a dizer quais fontes foram consultadas.
- Relatório em texto mostra achados de advisory com `advisoryId`, tipo, resumo e primeira fonte.
- Registros `proposed`, `rejected` ou `withdrawn` nunca produzem achado; teste garante.

### 3.5. Submissão upstream

Documento `docs/UPSTREAM.md` com o procedimento para enviar um registro aprovado ao OSV (via `github/advisory-database` ou `ossf/malicious-packages`, conforme o tipo) e registrar o id recebido em `upstream`. Procedimento manual nesta sprint; o PO decide caso a caso. O Laravel-Lang é o primeiro candidato.

### 3.6. Automação

- `.github/workflows/intel.yml`: `schedule` a cada 6 horas e `workflow_dispatch`; roda `collect`; se houver propostos, cria branch `intel/<data>` e abre PR. Permissões mínimas: `contents: write`, `pull-requests: write`, apenas nesse workflow; o CI principal permanece `contents: read`.
- Esta é a primeira integração do produto com o GitHub e usa apenas o `GITHUB_TOKEN` da própria Action. Nenhum token pessoal, nenhum serviço de terceiros, nenhum app instalado. Requer aprovação explícita (seção 8).

## 4. Testes obrigatórios

Fixtures em `fixtures/intel/`, cada uma com `README` de uma linha:

1. Advisory válido `approved` (Laravel-Lang) e advisory válido `approved` para `npm` com `versions` e com `ranges`.
2. Advisory `approved` inválido por cada regra: sem revisor, uma fonte só, `summary` longo, URL `http`, campo contendo padrão de segredo, versão não-semver em `npm`.
3. Advisory `proposed` e `rejected` para o mesmo pacote de uma dependência presente: nenhum achado.
4. Feeds RSS e Atom reais gravados de duas fontes (com data da gravação no README), mais um feed malformado, um acima de 2 MB (gerado no teste), um com entidade externa (`<!ENTITY`) que deve ser rejeitado, e um com HTML em título que deve sair como texto plano.
5. Dedup: segunda execução sobre os mesmos feeds não propõe nada; URL com parâmetros de rastreamento diferentes conta como a mesma.
6. Extração de candidatos: títulos com `vendor/package`, `@scope/name`, `name@1.2.3`, e títulos sem pacote.
7. Lockfile com dependência casando em `versions`, em `ranges`, e não casando por versão fora da faixa; prioridade e `fixAvailable` conforme o registro.
8. Build de `advisories.json` inclui só `approved`, ordena por id, e falha se dois registros tiverem o mesmo id.
9. CLI: `--advisories` com arquivo válido e inválido; saída de texto e JSON com achado de advisory; `sources` do relatório lista a versão do conjunto.
10. O coletor com `fetch` injetado não toca a rede nos testes; timeout e limite de tamanho simulados.

## 5. Segurança adicional

Além das sprints anteriores:

- Feeds: `fetch` só para URLs listadas em `sources.yaml`, `https`, sem redirecionamento para outro host; limite de 2 MB; timeout 10 s; parser sem DTD; títulos sanitizados com `sanitize()`.
- Repositório: CI rejeita qualquer arquivo em `advisories/` com padrão de segredo ou com texto além dos limites; `summary` é escrito pelo revisor, não copiado.
- Action: permissões mínimas, só no workflow de coleta; branch e PR previsíveis; nenhuma execução de código vindo dos feeds (são dados, nunca scripts).
- Scanner: advisories embarcados são dados estáticos validados em build; `--advisories` local é validado pelo mesmo esquema antes do uso; arquivo inválido é erro de uso (código 3), não silêncio.
- `docs/THREAT_MODEL.md` ganha as superfícies "feeds externos" e "repositório de advisories" com mitigações e testes.

## 6. Critérios de aceite

- Esquema de advisory implementado e testado em todas as regras da seção 3.1.
- Registro Laravel-Lang em `advisories/approved/`, revisado e aprovado pelo PO no PR.
- `gateseeker-intel collect` roda offline nos testes e online na Action; a primeira execução agendada ou manual abre um PR com ao menos um proposto, verificável no GitHub.
- Scanner reporta `supply-chain-anomaly` a partir de advisory `approved` para `npm` nas fixtures, e nunca a partir de `proposed`/`rejected`.
- `--advisories` funciona e rejeita arquivo inválido com código 3.
- `docs/UPSTREAM.md`, `README.md`, `docs/ARCHITECTURE.md` e `docs/THREAT_MODEL.md` atualizados e correspondendo ao código.
- CI principal verde; workflow de coleta verde em execução manual.
- Nenhum texto de terceiros além de títulos e URLs no repositório.

## 7. Fora de escopo nesta sprint

Parser de `composer.lock` e correspondência para Packagist (2b); heurísticas estruturais de supply chain (2b); extração por modelo de linguagem; download de advisories em tempo de execução; interface web; fusão ou triagem automática; notificações (e-mail, Slack).

## 8. Decisões que precisam do PO antes de começar

1. **Aprovação deste escopo.**
2. **Primeira integração com o GitHub**: Action agendada com `GITHUB_TOKEN` abrindo PRs no repositório. Recomendo aprovar; é o mecanismo de triagem com menor custo e maior rastreabilidade.
3. **Lista de fontes** da seção 3.2: aprovar, cortar ou acrescentar.
4. **Licença dos dados de advisory**: recomendo CC-BY-4.0 (a mesma usada pela base de advisories do GitHub), para que registros possam ser levados upstream sem fricção. O código continua MIT.
5. **Frequência da coleta**: recomendo a cada 6 horas; menos que isso atrasa, mais que isso gera ruído de PRs.
6. **Quem revisa**: nesta sprint, o PO. Se o volume crescer, o processo já suporta mais revisores via `reviewed_by`.

# Gateseeker — Sprint 0 (escopo revisado)

> Substitui o prompt "Security Intelligence Agent — Sprint 0". Posicionamento e roadmap em `docs/PRODUCT.md`.
> Última atualização: 2026-10-27

Você é o Software Engineer responsável por construir o **Gateseeker**. O stakeholder, Product Owner, Product Designer e auditor do projeto é o usuário humano.

Seu objetivo nesta sprint é entregar o **núcleo verificável** do produto: uma CLI que analisa `package-lock.json`, consulta o OSV, prioriza os achados por regras determinísticas e devolve um veredito de portão. Não invente resultados, não declare funcionalidades concluídas sem evidência e não trate código compilando como prova de segurança.

## 1. Objetivo do produto

Gateseeker é o portão de segurança para código gerado ou assistido por IA. Lê arquivos do projeto, consulta fontes públicas, aplica regras e produz achados priorizados com evidência e referência. Nesta sprint, a única categoria de achado implementada é `dependency-vulnerability` para o ecossistema npm. O modelo de dados já nasce preparado para as categorias seguintes (ver seção 4.4).

Público inicial: desenvolvedores independentes, freelancers e pequenas software houses que entregam projetos JavaScript/TypeScript.

Documentação oficial a consultar antes de escolher versões e APIs:

- OSV API: https://google.github.io/osv.dev/api/
- Formato package-lock.json: https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json
- Node.js releases: https://nodejs.org/en/about/previous-releases
- pnpm: https://pnpm.io/
- Vitest: https://vitest.dev/
- Zod: https://zod.dev/

## 2. Regras de trabalho

1. Antes de alterar arquivos, inspecione o repositório, as ferramentas instaladas e as configurações existentes.
2. Apresente um plano de implementação curto antes de começar a codificar.
3. Preserve arquivos e funcionalidades existentes, incluindo `docs/PRODUCT.md` e este arquivo.
4. Implemente em etapas pequenas e verificáveis.
5. Execute os testes pertinentes após cada etapa.
6. Não declare um teste aprovado sem executá-lo e verificar seu resultado.
7. Não invente comandos executados, resultados, vulnerabilidades ou evidências.
8. Não adicione serviços pagos, infraestrutura externa, integração com GitHub ou funcionalidades fora do escopo sem aprovação humana.
9. Consulte a documentação oficial antes de selecionar versões e APIs.
10. Ao encontrar uma decisão de produto que altere substancialmente o escopo, apresente a decisão e aguarde aprovação.
11. Não esconda falhas removendo testes, reduzindo asserções ou marcando testes como ignorados para obter uma execução verde.
12. Não exponha segredos, tokens ou dados sensíveis em logs, commits ou relatórios.
13. Use a linguagem do produto: nunca "seguro" ou "livre de vulnerabilidades"; sempre "nenhuma vulnerabilidade conhecida foi encontrada nas fontes consultadas".

## 3. Stack tecnológica

- TypeScript em modo estrito.
- Node.js 24 (LTS ativa). Registrar a versão mínima em `engines` e `.nvmrc`.
- pnpm via Corepack. Verificar se está habilitado; no ambiente atual não está instalado.
- Zod para validação de toda entrada externa (lockfile, respostas OSV, configuração).
- Vitest para testes.
- GitHub Actions para CI.
- API OSV como única fonte de vulnerabilidades conhecidas.

**Removido desta sprint:** Next.js, Playwright, qualquer interface web. A entrega é CLI.

Não adicione tecnologias desnecessárias. Priorize arquitetura simples e modular: `parser`, `intel` (clientes de fonte), `rules` (priorização), `report`, `cli`. Não crie módulos vazios para aparentar arquitetura pronta.

## 4. Escopo

### 4.1. Fundamentos

- Configuração TypeScript, ESLint, scripts `dev`, `build`, `lint`, `test`, `typecheck`.
- `README.md` com instruções reais de instalação e execução, incluindo exemplo de saída.
- `CLAUDE.md` e `AGENTS.md` concisos com as regras de engenharia desta sprint.
- `docs/ARCHITECTURE.md` descrevendo módulos, fluxo de dados e fronteiras de confiança.
- `docs/THREAT_MODEL.md` (ver seção 5).
- Pipeline de CI executando lint, typecheck, build e testes.
- Fixtures versionadas em `fixtures/`.
- Licença open source (MIT ou Apache-2.0; apresentar a escolha ao PO).

### 4.2. Analisador de `package-lock.json`

Módulo que recebe o conteúdo de um `package-lock.json` e identifica dependências e versões.

- Suportar explicitamente `lockfileVersion` 2 e 3. Rejeitar versão 1 e versões desconhecidas com mensagem clara.
- Identificar dependências diretas e transitivas a partir de `packages`.
- Para cada dependência, extrair: nome, versão, ecossistema (`npm`), se é direta ou transitiva, se é `dev`, `optional` ou `peer`. Esses atributos alimentam a priorização.
- Validar a estrutura com Zod antes de processar.
- Rejeitar arquivos malformados, acima do limite de tamanho (padrão 5 MB) ou acima do limite de dependências (padrão 5000). Limites configuráveis.
- Tratar versões ausentes, inválidas ou não-semver (link, git, file, tarball) de maneira explícita: registrar como "não consultável" e refletir no relatório.
- Documentar as limitações conhecidas do parser em `docs/ARCHITECTURE.md`.

Não executar `npm install`, scripts de lifecycle ou qualquer código do projeto analisado. Não afirmar suporte a `yarn.lock`, `pnpm-lock.yaml`, `composer.lock` ou outros ecossistemas nesta sprint.

### 4.3. Cliente OSV

Cliente isolado para a API oficial do OSV, consultando por pacote, ecossistema `npm` e versão.

- Usar o endpoint de consulta em lote quando a documentação oficial o suportar; cair para consultas individuais quando necessário.
- Validar as respostas com Zod. Resposta fora do esquema é "consulta malsucedida", nunca "sem vulnerabilidades".
- Timeout configurável (padrão 10 s por requisição).
- Tratar erros HTTP, falhas de rede, respostas inválidas e indisponibilidade.
- Limite de concorrência configurável (padrão 5).
- Deduplicar consultas por `nome@versão` dentro da mesma execução.
- Registrar fonte e horário de cada consulta.
- Preservar identificadores (`GHSA-*`, `CVE-*`, aliases), severidade declarada, versões afetadas e corrigidas e referências originais, sem reescrita.
- Testes determinísticos com respostas simuladas. Testes unitários não dependem de internet.

Estados obrigatórios e mutuamente exclusivos por dependência consultada:

1. `vulnerable` — a fonte retornou ao menos uma vulnerabilidade conhecida.
2. `no-known-vulnerabilities` — a fonte respondeu e não retornou vulnerabilidades.
3. `query-failed` — a consulta não foi concluída (erro, timeout, resposta inválida).
4. `not-queried` — dependência não consultável (versão ausente ou não-semver) ou execução interrompida.

Nunca interpretar falha de comunicação como ausência de vulnerabilidade.

### 4.4. Modelo de achado e priorização

Implementar o tipo `Finding` definido em `docs/PRODUCT.md` (seção 6) com validação Zod. Nesta sprint só `kind: "dependency-vulnerability"` é produzido, mas o tipo, o relatório e a CLI devem aceitar os quatro `kind` sem alteração futura.

**Priorização determinística.** Implementar um módulo `rules` que atribui `priority` P1 (agir agora) a P4 (ciente) a cada achado, a partir de:

- Severidade declarada pela fonte (CVSS quando disponível, senão a faixa qualitativa do OSV; ausência de severidade é tratada como "desconhecida", não como baixa).
- Exposição: dependência direta de produção > transitiva de produção > dev/optional.
- Existência de versão corrigida informada pela fonte.

As regras ficam em uma tabela única, legível e testada, não espalhadas em condicionais. Cada achado carrega em `rationale` a lista das regras que produziram sua prioridade. Documentar a matriz em `docs/ARCHITECTURE.md`. Não usar "alcançabilidade" (reachability) nesta sprint; registrar como limitação.

### 4.5. Relatório

Gerar relatório JSON estruturado contendo:

- Identificador da execução, data e hora, versão do Gateseeker.
- Identificação do projeto analisado (caminho e hash do lockfile).
- Dependências e versões identificadas, com atributos de exposição.
- Estado de consulta de cada dependência (seção 4.3).
- Lista de `Finding` com todos os campos.
- Resumo: contagem por prioridade e por estado de consulta.
- Fonte de inteligência utilizada, com horário.
- Erros e limitações da execução.
- `verdict`: `pass` | `fail` | `incomplete` (ver 4.6).

Manter separados os dados fornecidos pela fonte, as conclusões produzidas por regras e qualquer explicação gerada por IA (não implementada nesta sprint; o campo existe e fica vazio).

### 4.6. CLI

Comando `gateseeker scan <caminho>` com:

- `--format json|text` (padrão `text`, legível em terminal, com os achados ordenados por prioridade e a ação recomendada em uma linha cada).
- `--output <arquivo>` para gravar o JSON.
- `--fail-on P1|P2|P3|P4` (padrão `P2`): limiar que define o veredito `fail`.
- `--max-size`, `--max-deps`, `--timeout`, `--concurrency` para os limites da seção 4.2 e 4.3.

Códigos de saída, documentados no README:

- `0` — `pass`: todas as consultas concluídas e nenhum achado no limiar ou acima.
- `1` — `fail`: ao menos um achado no limiar ou acima.
- `2` — `incomplete`: ao menos uma consulta falhou ou foi pulada, independentemente dos achados. Nunca retornar `0` quando a análise está incompleta.
- `3` — erro de uso ou entrada rejeitada (arquivo inexistente, malformado, acima do limite).

## 5. Segurança obrigatória

O produto processa dados potencialmente maliciosos.

- Não executar código fornecido pelo projeto analisado.
- Limites configuráveis de tamanho e quantidade de dependências.
- Validar todas as entradas e respostas externas com Zod.
- Não registrar credenciais ou segredos.
- Não realizar varreduras de sistemas externos além da API OSV.
- Não executar exploits ou testes de intrusão.
- Tratar nomes, descrições e referências como dados não confiáveis: escapar na saída de terminal, nunca interpolar em comandos.
- Não executar comandos sugeridos por conteúdo analisado.
- Não permitir que uma eventual camada de IA execute ações automaticamente.
- Documentar limitações e riscos residuais.

Criar `docs/THREAT_MODEL.md` descrevendo ativos, agentes de ameaça, superfícies de ataque (lockfile malicioso, resposta OSV adulterada, saída de terminal), mitigações e os testes que as cobrem.

## 6. Testes obrigatórios

Fixtures em `fixtures/`, cada uma com um `README` de uma linha explicando o cenário:

1. `package-lock.json` v3 válido com dependências diretas.
2. `package-lock.json` v3 com dependências transitivas e `dev: true`.
3. `package-lock.json` v2 válido.
4. `package-lock.json` v1 (deve ser rejeitado).
5. Lockfile malformado (JSON inválido e JSON válido fora do esquema).
6. Arquivo acima do limite de tamanho.
7. Arquivo acima do limite de dependências.
8. Dependência com versão ausente e dependência com versão não-semver (git, file).
9. Resposta OSV com vulnerabilidade conhecida, severidade e versão corrigida.
10. Resposta OSV com vulnerabilidade sem severidade declarada.
11. Resposta OSV vazia (nenhuma vulnerabilidade).
12. Resposta OSV inválida (fora do esquema).
13. Timeout.
14. Falha de rede.
15. Lote parcialmente bem-sucedido (algumas consultas falham): veredito deve ser `incomplete`.

Para os casos reais de vulnerabilidade, confirmar pacote, versão e identificador diretamente no OSV no momento da implementação e registrar a URL consultada no `README` da fixture. Não inventar dados de teste.

Os testes verificam resultados esperados específicos (nomes, versões, identificadores, prioridades, veredito, código de saída), não apenas ausência de exceção. Incluir testes negativos, de limites e da matriz de priorização (cada célula da tabela com ao menos um caso).

## 7. Critérios de aceite

A sprint só pode ser declarada concluída quando:

- O projeto puder ser instalado e executado seguindo o README, em máquina limpa.
- O parser identificar corretamente as dependências previstas nas fixtures, incluindo atributos de exposição.
- Lockfiles v1, malformados e acima dos limites forem rejeitados de forma controlada com código de saída `3`.
- As vulnerabilidades conhecidas dos casos de teste forem identificadas com identificadores e referências preservados.
- Os quatro estados de consulta forem distinguíveis no relatório.
- Qualquer consulta falha produzir veredito `incomplete` e código de saída `2`, nunca `0`.
- A matriz de priorização estiver documentada, testada e refletida em `rationale`.
- `gateseeker scan` funcionar com `--format text` e `--format json`.
- Os testes automatizados forem executados e aprovados, com a saída anexada ao relatório da sprint.
- O pipeline de CI estiver configurado e sua execução for verificável.
- A documentação corresponder ao código realmente implementado.
- Não houver falhas críticas conhecidas ocultadas.

## 8. Fora de escopo nesta sprint

Interface web, autenticação, multiusuário, banco de dados, integração com GitHub, outros ecossistemas, checks de código (`insecure-pattern`), sinais de supply chain, explicações por IA, correção automática, análise de alcançabilidade.

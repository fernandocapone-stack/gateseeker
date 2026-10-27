# Gateseeker — Sprint 2b: Composer e sinais estruturais de supply chain

> Status: **proposta, aguardando aprovação do PO**. Depende da Sprint 2a (feed curado) e da 2a-UI (triagem), ambas concluídas em 2026-10-27.
> Última atualização: 2026-10-27

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano, que não é desenvolvedor: apresente decisões em linguagem simples. As regras de trabalho, a stack e os controles de segurança das sprints anteriores continuam valendo.

## 1. Objetivo da sprint

Fazer o Gateseeker detectar o caso que motivou o produto: um projeto PHP que instalou os pacotes Laravel-Lang comprometidos. Hoje o registro `GSK-ADV-2026-0001` está aprovado mas não casa com nada, porque o scanner só lê `package-lock.json`. Esta sprint entrega:

1. **Leitura de `composer.lock`** e consulta ao OSV para o ecossistema Packagist, com os mesmos quatro estados de consulta e o mesmo veredito.
2. **Correspondência de advisories para Composer**, pela regra definida na revisão do registro inaugural: um pacote está afetado quando o commit fixado no lock foi criado depois do início da janela e não coincide com o commit que a tag aponta hoje, ou quando a versão/tag está na lista do registro.
3. **Sinais estruturais de supply chain** que não dependem de ninguém ter publicado nada: mudanças suspeitas entre dois lockfiles (o que um PR de atualização de dependência traz), e características de risco do lockfile atual.
4. **Coletor consulta o OSV** para cada pacote candidato e marca a proposta como "já coberto" antes de chegar ao revisor, com o id do registro oficial pré-preenchido em `upstream` e em `draft`.

**Hipótese a validar:** em um projeto Laravel real com um `composer.lock` que fixava Laravel-Lang numa tag reescrita, o Gateseeker produz um achado `supply-chain-anomaly` P1 com a ação correta; em projetos PHP limpos, zero achados dessa categoria. Métrica da `docs/PRODUCT.md` para a 2b: 50 instalações orgânicas via npm e 1 relato de supply chain detectado em projeto real; a segunda parte é o que esta sprint torna possível.

## 2. Princípios específicos

1. **Determinismo mantido.** Os sinais estruturais são comparações de texto e de datas; nenhum modelo decide.
2. **Rede só para fontes já aprovadas.** OSV (já usado) e, para a regra de commit versus tag, a API pública do GitHub e do Packagist, somente leitura, sem token, com os mesmos limites de timeout, concorrência e deduplicação do cliente OSV. Falha de rede nunca vira "limpo": vira `query-failed` e veredito `incomplete`.
3. **Sinais estruturais começam em modo aviso**, como os padrões de código da Sprint 1, até a precisão ser medida em projetos reais.
4. **Nada é executado.** `composer.lock` é texto; nenhum `composer install`, nenhum script.
5. **O PO decide sem ler JSON.** Toda decisão de produto desta sprint é apresentada em linguagem simples; o resultado da validação vai em tabela.

## 3. Escopo

### 3.1. Parser de `composer.lock`

Módulo `src/parser/composer.ts`, mesma arquitetura e limites do parser npm.

- Lê `packages` e `packages-dev`. Para cada pacote: `name`, `version`, `source.type`, `source.url`, `source.reference` (commit), `dist.url`, `time`, `autoload` e `scripts`, quando presentes.
- Exposição: `direct` quando o nome aparece em `require` ou `require-dev` do `composer.json` ao lado do lock (se existir), `production` quando não está em `packages-dev`.
- Estados de versão: `ok` para versões `vX.Y.Z` ou `X.Y.Z`; `non-semver` para `dev-main`, `dev-*` e aliases; `non-registry` quando `dist.url` não aponta para Packagist/GitHub. A normalização `v1.2.3` → `1.2.3` é registrada no relatório.
- Validação por Zod; rejeição de arquivos malformados, acima de 5 MB ou de 5000 pacotes; limitações documentadas.
- `Dependency` ganha os campos opcionais `sourceReference`, `sourceUrl` e `releasedAt` (do campo `time`), usados pelas regras abaixo.

### 3.2. Consulta ao OSV para Packagist

O cliente existente passa a aceitar `ecosystem: "Packagist"` com nome `vendor/package` e versão normalizada. Testes com resposta real gravada: pelo menos um pacote Composer com vulnerabilidade conhecida no OSV, confirmado no momento da implementação e documentado em `fixtures/osv/README.md`.

### 3.3. Correspondência de advisories para Composer

Em `src/intel/advisories.ts`, para `ecosystem: Packagist`:

- `affected.versions` / `affected.ranges`: igual ao npm, sobre a versão normalizada.
- `affected.tags` com `commits_after`: o pacote está afetado quando `releasedAt` ou a data do commit de `sourceReference` é posterior a `commits_after` **e** o commit não coincide com o commit atual da tag na origem. A verificação do commit atual da tag é feita pela API do GitHub (ou Packagist) quando `source.url` aponta para lá; sem rede, o achado é emitido como `supply-chain-anomaly` com `confidence: "unverified"` e a ação pede verificação manual, e a consulta fica `query-failed` para fins de veredito.
- O achado traz o commit fixado, a data, a tag e o que foi comparado, para que o revisor humano consiga conferir.

### 3.4. Sinais estruturais (novas regras, `kind: "supply-chain-anomaly"`, modo aviso)

| Id | Sinal | Severidade | Como detecta | Falso positivo evitado |
|---|---|---|---|---|
| `GSK-SC-001` | Dependência fixada em commit, não em versão publicada | MODERATE | `composer.lock` com `source.reference` cuja `version` é `dev-*` ou cujo `dist` aponta para um commit específico fora de uma release; `package-lock.json` com `resolved` em `git+` ou commit. | Pacotes `dev-*` em `packages-dev`; pacotes do próprio workspace. |
| `GSK-SC-002` | Lockfile atualizado traz `autoload.files` ou scripts de instalação novos em pacote já existente | HIGH | Compara o lock atual com o lock da base (`--baseline <arquivo>`, ou `git show <ref>:composer.lock` fornecido pelo usuário; o Gateseeker não roda git). Para cada pacote presente nos dois, dispara se `autoload.files` ganhou entradas ou se `scripts` (`post-install-cmd`, `post-autoload-dump` e similares) apareceu. No npm, idem para `preinstall`/`postinstall` quando o lock expõe `hasInstallScript`. | Pacote novo no lock (não há "antes"); entradas iguais nos dois. |
| `GSK-SC-003` | Mesma versão, commit diferente | CRITICAL | Entre dois `composer.lock`, um pacote com a mesma `version` mas `source.reference` diferente. Esse é exatamente o rastro de uma tag reescrita. | Versões diferentes (atualização normal). |
| `GSK-SC-004` | Pacote recém-publicado | LOW | `releasedAt` nos últimos N dias (padrão 3) para um pacote que já existia no lock de base com outra versão. Informativo: dá tempo para o ecossistema reagir. | Primeira instalação; `--max-release-age-days 0` desliga. |
| `GSK-SC-005` | Mudança de origem | HIGH | Entre dois locks, `source.url` ou `dist.url` de um pacote muda de host (ex.: de github.com para outro domínio). | Mudança de protocolo ou de caminho no mesmo host. |

Sem baseline, só `GSK-SC-001` e `GSK-SC-004` rodam; o relatório declara que a comparação não foi feita.

### 3.5. Comparação com baseline na CLI

- `gateseeker scan <pasta> --baseline <caminho>`: caminho para um `composer.lock` ou `package-lock.json` anterior. Em CI, o usuário obtém o arquivo com `git show origin/main:composer.lock > /tmp/base.lock` antes de chamar o Gateseeker; a documentação mostra o passo.
- O relatório ganha `baseline: { path, sha256, packagesCompared, added, removed, changed }`.

### 3.6. Coletor consulta o OSV

Em `src/intel/feed/collect.ts`, para cada candidato extraído com ecossistema reconhecido, consulta `POST /v1/query` sem versão. Se houver registro, a proposta recebe `draft.upstream` com o primeiro id (`MAL-`, `GHSA-`, `PYSEC-`) e `draft.notes: "Já coberto pelo OSV"`, e a interface de triagem mostra o selo "já coberto pelo OSV" no cartão (campo já previsto na 2a-UI). A decisão continua humana. Candidatos sem nome extraído não são consultados.

### 3.7. Validação em projetos reais

Após os testes passarem, repetir o método da Sprint 1 em 5 repositórios públicos PHP/Laravel, propostos pelo engenheiro e aprovados pelo PO antes de clonar. Pelo menos um deles deve ter dependido de Laravel-Lang em maio de 2026; se o histórico do repositório permitir, o `composer.lock` da época é usado como lock atual e o de hoje como baseline, para reproduzir a detecção. Resultado em `docs/VALIDATION_SPRINT_2B.md`, com precisão por regra e nada de segredo real.

## 4. Testes obrigatórios

Fixtures em `fixtures/composer/`, cada uma com `README` de uma linha:

1. `composer.lock` válido com pacotes diretos, dev e transitivos, mais o `composer.json` ao lado.
2. Lock com `dev-main`, alias e pacote de origem não-registry.
3. Lock malformado, acima do limite de tamanho e acima do limite de pacotes.
4. Par de locks (atual e baseline) que reproduz o padrão Laravel-Lang: mesma versão, `source.reference` diferente, `autoload.files` novo. Sintético, construído a partir dos fatos do registro `GSK-ADV-2026-0001`, nunca com código do atacante.
5. Par de locks com atualização normal (versão muda, commit muda): zero achados `GSK-SC-003`.
6. Resposta real do OSV para um pacote Composer vulnerável e `{}` para um limpo.
7. Correspondência do registro Laravel-Lang: lock com commit posterior a `2026-05-22T22:32Z` → achado; lock com commit anterior → nenhum; sem rede → `unverified` + `incomplete`.
8. Resposta simulada da API do GitHub para a tag (commit igual e diferente), timeout e erro.
9. Coletor com OSV simulado: candidato coberto recebe `draft.upstream`; candidato não coberto, não; falha do OSV não bloqueia a proposta.
10. CLI: `--baseline` com arquivo válido, inválido e de ecossistema diferente do lock atual (erro de uso, código 3).

Testes verificam ids, caminhos, prioridades e vereditos específicos; nenhum teste toca a rede.

## 5. Segurança adicional

- `composer.lock` e `composer.json` são texto não confiável: limites, validação, nada executado, nomes sanitizados na saída.
- Chamadas à API do GitHub e do Packagist: só `https`, só os hosts fixos, sem token, timeout, concorrência limitada, respostas validadas por Zod; falha nunca vira "limpo".
- `docs/THREAT_MODEL.md` ganha a superfície "baseline fornecida pelo usuário" (um atacante que controla o lock de base pode esconder uma mudança: o relatório sempre imprime o hash dos dois arquivos).

## 6. Critérios de aceite

- `gateseeker scan` em pasta com `composer.lock` consulta o OSV para Packagist com os quatro estados de consulta e o veredito correto.
- O registro `GSK-ADV-2026-0001` produz um achado P1 no fixture que reproduz o caso, e nenhum achado no lock anterior ao ataque.
- As cinco regras estruturais implementadas com fixtures positiva e negativa, em modo aviso por padrão.
- `--baseline` documentado com o passo de `git show` para CI.
- Coletor marca candidatos cobertos pelo OSV; a interface mostra o selo.
- Validação em 5 projetos PHP reais registrada, nenhuma regra abaixo de 90% sem ficar marcada `experimental`.
- `README.md`, `docs/ARCHITECTURE.md` e `docs/THREAT_MODEL.md` atualizados; CI verde.

## 7. Fora de escopo

Suporte a `yarn.lock` e `pnpm-lock.yaml`; verificação de assinaturas ou proveniência (Sigstore, npm provenance); download de advisories em tempo de execução; integração que execute git por conta própria; qualquer ecossistema além de npm e Composer.

## 8. Decisões que precisam do PO antes de começar

1. **Aprovação deste escopo.**
2. **Chamadas à API pública do GitHub e do Packagist** durante a varredura, só leitura e sem token, para comparar o commit fixado com a tag atual. Sem isso a regra fica em "não verificado". Recomendo aprovar.
3. **Lista dos 5 projetos PHP** para validação: o engenheiro propõe antes de clonar, como na Sprint 1.

# Gateseeker — Posicionamento de produto

> Status: rascunho para aprovação do PO, orienta a Sprint 0. Revisar ao fim de cada sprint.
> Última atualização: 2026-10-28 (Sprint 4 publicada em `gateseeker.vercel.app`; próximas sprints em `docs/ROADMAP.md`)

## 1. Nome

**Gateseeker.** Mantido.

- Verificado em 2026-10-27: `gateseeker`, `@gateseeker/cli` e `gate-seeker` livres no npm. Nenhum produto, startup ou projeto de software com esse nome encontrado em busca web.
- O usuário `gateseeker` no GitHub existe (criado em 2026-01-08, sem repositórios) e **não pertence ao PO**. Em 2026-10-28 o PO criou a organização `gateseeker-dev` e os repositórios foram transferidos para ela; a Action passa a ser `gateseeker-dev/gateseeker@v1` (o GitHub redireciona o nome antigo `fernandocapone-stack/gateseeker`).
- Registrar antes do lançamento público: pacote npm `gateseeker`, domínio `.dev` ou `.io`. Marca no INPI só quando houver receita.

**O que o nome não faz sozinho:** ele não explica o produto. "Seeker" soa passivo (quem procura), e o produto é ativo (quem barra). A tagline e o branding fazem esse trabalho e **serão trabalhados pelo PO em paralelo, sem bloquear as sprints** (decisão de 2026-10-27). Até lá, o repositório usa uma descrição funcional provisória:

> *Security gate for AI-generated code.* (provisória, não é a tagline final)

Binário da CLI: `gateseeker`. Sem alias curto por enquanto.

## 2. Problema

Código gerado por IA (Cursor, Lovable, Bolt, v0, Replit, Copilot, Claude Code) chega à produção com falhas de segurança em taxa muito acima do código revisado por humanos. Os padrões dominantes são previsíveis: autorização ausente, segredos no cliente, banco exposto (Supabase sem RLS), CORS aberto, dependências vulneráveis ou maliciosas. Nenhuma das ferramentas de geração roda uma verificação de segurança pós-geração.

Quem constrói com essas ferramentas (freelancers, fundadores técnicos, pequenas software houses) não tem especialista de segurança, não vai ler um relatório de 400 linhas e já ignora os alertas do Dependabot porque não sabe qual importa.

## 3. Público

**Primário (Sprint 0 a 2):** desenvolvedores independentes e pequenas software houses (1 a 10 pessoas) que entregam projetos JavaScript/TypeScript, principalmente stacks React/Next + Supabase/Firebase gerados ou assistidos por IA.

**Secundário (Sprint 2+):** agências e freelancers PHP/Laravel, onde o ferramental de supply chain é mais fraco e o caso Laravel-Lang (maio/2026) é argumento de venda.

**Não é público:** empresas com time de AppSec. Elas já têm Snyk, Aikido, Socket ou Semgrep.

## 4. Posicionamento

Gateseeker **não compete** com Snyk, Aikido ou `npm audit` em cobertura de CVE. Esses são commodities gratuitas. Gateseeker compete em três coisas que eles fazem mal para o nosso público:

| Pilar | O que significa | Por que os incumbentes falham |
|---|---|---|
| **Priorização explicável** | Dos 40 alertas, quais 3 importam neste projeto, por quê, e o que fazer em uma frase. Regras determinísticas e auditáveis, não opinião de LLM. | Relatórios planos ordenados por CVSS, sem contexto do projeto. |
| **Padrões de código gerado por IA** | Checks determinísticos para as falhas típicas de vibe coding: segredo em bundle de cliente, RLS desligado, rota sem auth, CORS `*`, `eval` em input, debug ligado em produção. | SCA não olha código. SAST genérico gera ruído e não fala a língua de quem usa Lovable. |
| **Gate, não relatório** | Roda no CI ou antes do deploy, bloqueia com código de saída e diz exatamente o que corrigir. | Ferramentas pensadas como dashboard; o alerta chega por e-mail e morre lá. |

## 5. O que Gateseeker é e não é

**É:** um verificador local e determinístico. Lê arquivos do projeto, consulta fontes públicas de vulnerabilidade, aplica regras, produz achados priorizados com evidência e referência, e devolve um veredito de portão (passa / bloqueia / incompleto).

**Não é:** scanner de infraestrutura, pentest, ferramenta de intrusão, monitor de runtime. Não executa código do projeto analisado. Não corrige automaticamente sem aprovação humana. Não usa IA para decidir se uma vulnerabilidade existe.

Linguagem obrigatória: nunca "projeto seguro" ou "livre de vulnerabilidades". Sempre "nenhuma vulnerabilidade conhecida foi encontrada nas fontes consultadas".

## 6. Modelo de achado (unificado desde a Sprint 0)

Todo resultado do Gateseeker é um `Finding` com o mesmo contrato, independente da origem. Isso evita reescrita quando novas categorias entrarem.

```
Finding
  id              identificador estável do achado nesta execução
  kind            "dependency-vulnerability" | "insecure-pattern" | "supply-chain-anomaly" | "secret-exposure"
  subject         o que foi afetado (pacote@versão, arquivo:linha, config)
  evidence        dados brutos da fonte ou do arquivo, sem interpretação
  source          de onde veio (osv.dev, regra interna X), com horário da consulta
  severity        severidade declarada pela fonte, quando houver
  priority        P1..P4, calculada por regras determinísticas documentadas
  rationale       lista das regras que levaram à prioridade (auditável)
  remediation     ação concreta, quando a fonte ou a regra informar
  references      URLs e identificadores originais, preservados
```

Camadas separadas e nunca misturadas: **dados da fonte** → **conclusões por regra** → **explicação por IA (futura, opcional, nunca decisória)**.

## 7. Roadmap

| Sprint | Entrega | Hipótese que valida |
|---|---|---|
| **0** | CLI `gateseeker scan` para `package-lock.json` (v2/v3) com consulta OSV, priorização contextual P1–P4, relatório JSON, exit codes de portão, threat model, CI. | Conseguimos construir o núcleo de forma verificável e honesta. Base técnica para tudo o que vem depois. |
| **1** | Primeiro conjunto de `insecure-pattern` para stacks de vibe coding (segredos em código de cliente, Supabase RLS, variáveis `NEXT_PUBLIC_` sensíveis, CORS aberto). Saída em terminal legível por humano. | Devs de Lovable/Bolt/Cursor acham os achados úteis e acionáveis. Testar com 5 projetos reais. |
| **2a** | **Feed de inteligência curado.** Formato próprio de advisory (ecossistema, pacote, versões/tags/commits afetados, janela, indicador, fonte, data). Job agendado coleta fontes que publicam incidentes antes das bases oficiais (StepSecurity, Socket, Aikido, Phoenix, Snyk, Wiz, The Hacker News, listas do Packagist e npm), deduplica e abre PR propondo registros; humano aprova; só então o scanner consulta o feed ao lado do OSV, com `source: gateseeker-advisories`. Laravel-Lang (maio/2026) é o registro inaugural. Registros aprovados são submetidos ao OSV/GHSA. | Fontes estruturadas não cobrem ataques por reescrita de tag (OSV sem registro dos pacotes Laravel-Lang cinco meses depois, verificado em 2026-10-27). Um feed curado detecta o que `npm audit` e `composer audit` não detectam e gera conteúdo público. |
| **2b** | `composer.lock` + Packagist/OSV + feed. Heurísticas estruturais de supply chain sem depender de notícia: referência de commit no lock divergente da tag atual na origem, `autoload.files` novo em pacote conhecido, install scripts. | O público PHP responde à história Laravel-Lang. |
| **3** | GitHub Action oficial com gate configurável, SARIF, comentário no PR, publicação no npm com proveniência, repositório público. Entregue em 2026-10-28 (`docs/SPRINT_3.md`); a interface web foi movida para a Sprint 4. | Alguém adota o portão. |
| **4** | **Gateseeker na web**: página pública onde a pessoa cola a URL de um repositório público do GitHub e recebe o relatório em até um minuto; mesmo motor, sem instalar nada. Vercel + Supabase, primeiros serviços hospedados (`docs/SPRINT_4.md`). Por decisão do PO (2026-10-28) a análise fica atrás de login com GitHub e o relatório salvo (`/r/<id>`) abre só para a conta que o gerou, não é um link público. | Alguém que nunca ouviu falar do produto encontra valor em um minuto, e a página vira funil para a Action. |

Sprints 5 em diante, a Track A (agentes de código como superfície de risco) e as decisões abertas estão em `docs/ROADMAP.md`. O login entrou na Sprint 4 (decisão do PO); continuam fora até validação: times e multiusuário, histórico no servidor, explicações geradas por IA, correção automática.

## 8. Decisões tomadas e seus motivos

- **npm primeiro, PHP depois.** As ferramentas de vibe coding geram quase só JavaScript/TypeScript. É onde o público está hoje. PHP é a segunda aposta, não a primeira, apesar de ter sido a inspiração.
- **CLI primeiro, web depois.** Interface web na Sprint 0 adicionaria Next.js e Playwright sem validar nada. O público-alvo vive no terminal e no CI.
- **OSV como única fonte de CVE na Sprint 0.** Gratuita, oficial, com API estável. Limitação verificada: OSV não tem registro algum dos pacotes Laravel-Lang comprometidos (consulta em 2026-10-27, cinco meses após o ataque). Isso é tratado pelo feed curado (Sprint 2a) e por `supply-chain-anomaly` (Sprint 2b), não por CVE.
- **Prioridade por regras, não por modelo.** Confiança e auditabilidade são o produto. Um LLM pode um dia *explicar* um achado; nunca vai *decidir* se ele existe ou qual é sua prioridade.
- **Inteligência da web entra por pipeline separado, nunca na varredura (decisão do PO, 2026-10-27).** O robô coleta e propõe; um humano aprova; o scanner consome só registros aprovados, de forma determinística. Só fatos estruturados e o link da fonte são armazenados, nunca o texto dos posts. Se a extração usar um modelo de linguagem, é serviço pago e exige aprovação; a alternativa sem custo é coleta e dedup automáticas com extração manual na triagem. O pipeline roda por GitHub Action agendada, sem depender de sessão interativa.
- **Ordem das sprints: 1 → 2a → 2b → 3.** Padrões de código gerado por IA primeiro, por ser o público maior e mais imediato; feed de inteligência antes do suporte a PHP, porque o feed é pré-requisito para a história de supply chain fazer sentido.
- **Open core.** CLI e regras abertas (MIT ou Apache-2.0). Monetização futura em histórico, times, política de portão e suporte. Sem código aberto, ninguém do nosso público instala uma ferramenta de segurança desconhecida.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Aikido ou Snyk lançam "modo vibe coder" grátis. | Velocidade e foco. Eles têm centenas de clientes enterprise para atender; nós temos um público. |
| Projetos open source de nicho já miram Supabase/Lovable (observado em 2026-10-27: supashield 104★, VibeRaven 61★, database-sentinel 50★, vibe-scanner 23★, checklist vibe-coding-security 15★). Nenhum combina dependências + padrões de código + feed curado + gate em CI, e a maioria é só RLS. | Diferenciação pela amplitude integrada e pela priorização explicável; acompanhar esses projetos a cada sprint e considerar contribuição ou interoperabilidade em vez de competição direta onde fizer sentido. |
| Os checks de `insecure-pattern` geram falsos positivos e o dev desinstala. | Cada regra nasce com fixture positiva e negativa. Regra sem teste não entra. Regras começam em modo aviso, não bloqueio. |
| OSV indisponível ou lento. | Timeout, concorrência limitada, cache por execução, e veredito "incompleto" que nunca vira "passou". |
| Feed curado gera ruído ou registro errado a partir de um post exagerado. | Triagem humana obrigatória antes de qualquer registro virar achado; dedup por pacote e janela; cada registro cita a fonte e a data. |
| Feed cria falsa sensação de cobertura total. | A linguagem continua "nenhuma vulnerabilidade conhecida nas fontes consultadas" e cada relatório lista as fontes consultadas. |
| Ninguém paga. | Open core valida uso antes de validar receita. Métrica da Sprint 1 é instalação e retenção, não dinheiro. |

## 10. Métricas de validação

- Sprint 0: critérios de aceite técnicos (ver `docs/SPRINT_0.md`).
- Sprint 1: 5 projetos reais de vibe coding analisados; pelo menos 3 devs dizem que corrigiriam algo apontado.
- Sprint 2a: pipeline rodando sozinho por 4 semanas; ao menos 5 registros aprovados além do Laravel-Lang; ao menos 1 registro aceito upstream no OSV/GHSA.
- Sprint 2b: 50 instalações orgânicas via npm; 1 relato de supply chain detectado em projeto real.
- Sprint 3: 10 repositórios com a GitHub Action ativa por 30 dias.
- Sprint 4: 100 análises de repositórios distintos em 30 dias; 20 links compartilhados abertos por terceiros; 10 cliques em "usar no CI" vindos da página.

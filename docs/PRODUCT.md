# Gateseeker — Posicionamento de produto

> Status: rascunho para aprovação do PO, orienta a Sprint 0. Revisar ao fim de cada sprint.
> Última atualização: 2026-10-27

## 1. Nome

**Gateseeker.** Mantido.

- Verificado em 2026-10-27: `gateseeker`, `@gateseeker/cli` e `gate-seeker` livres no npm. Nenhum produto, startup ou projeto de software com esse nome encontrado em busca web. O usuário `gateseeker` no GitHub existe (criado em 2026-01-08, sem repositórios e sem perfil); assumimos que é reserva do próprio PO. Confirmar.
- Registrar antes da Sprint 1: pacote npm `gateseeker`, organização GitHub, domínio `.dev` ou `.io`. Marca no INPI só quando houver receita.

**O que o nome não faz sozinho:** ele não explica o produto. "Seeker" soa passivo (quem procura), e o produto é ativo (quem barra). A tagline e o branding fazem esse trabalho e **ainda serão trabalhados pelo PO**. Até lá, o repositório usa uma descrição funcional provisória:

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
| **2** | `composer.lock` + Packagist/OSV. Sinais de supply chain: dependência apontando para commit/tag em vez de versão publicada, `autoload.files` novo em pacote conhecido, install scripts. | O público PHP responde à história Laravel-Lang. |
| **3** | GitHub Action oficial com gate configurável. Interface web mínima para ler relatórios e histórico. | Alguém paga por histórico, times e política de portão. |

Fora de qualquer sprint até validação: autenticação, multiusuário, banco de dados, explicações geradas por IA, correção automática.

## 8. Decisões tomadas e seus motivos

- **npm primeiro, PHP depois.** As ferramentas de vibe coding geram quase só JavaScript/TypeScript. É onde o público está hoje. PHP é a segunda aposta, não a primeira, apesar de ter sido a inspiração.
- **CLI primeiro, web depois.** Interface web na Sprint 0 adicionaria Next.js e Playwright sem validar nada. O público-alvo vive no terminal e no CI.
- **OSV como única fonte de CVE.** Gratuita, oficial, com API estável. Limitação registrada: OSV não detecta pacote malicioso que reescreveu tag existente sem versão nova (caso Laravel-Lang). Isso é tratado por `supply-chain-anomaly` na Sprint 2, não por CVE.
- **Prioridade por regras, não por modelo.** Confiança e auditabilidade são o produto. Um LLM pode um dia *explicar* um achado; nunca vai *decidir* se ele existe ou qual é sua prioridade.
- **Open core.** CLI e regras abertas (MIT ou Apache-2.0). Monetização futura em histórico, times, política de portão e suporte. Sem código aberto, ninguém do nosso público instala uma ferramenta de segurança desconhecida.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Aikido ou Snyk lançam "modo vibe coder" grátis. | Velocidade e foco. Eles têm centenas de clientes enterprise para atender; nós temos um público. |
| Os checks de `insecure-pattern` geram falsos positivos e o dev desinstala. | Cada regra nasce com fixture positiva e negativa. Regra sem teste não entra. Regras começam em modo aviso, não bloqueio. |
| OSV indisponível ou lento. | Timeout, concorrência limitada, cache por execução, e veredito "incompleto" que nunca vira "passou". |
| Ninguém paga. | Open core valida uso antes de validar receita. Métrica da Sprint 1 é instalação e retenção, não dinheiro. |

## 10. Métricas de validação

- Sprint 0: critérios de aceite técnicos (ver `docs/SPRINT_0.md`).
- Sprint 1: 5 projetos reais de vibe coding analisados; pelo menos 3 devs dizem que corrigiriam algo apontado.
- Sprint 2: 50 instalações orgânicas via npm; 1 relato de supply chain detectado em projeto real.
- Sprint 3: 10 repositórios com a GitHub Action ativa por 30 dias.

# Gateseeker — Sprint 2a-UI: interface de triagem do feed

> Status: **implementada em 2026-10-27** (aprovada pelo PO no mesmo dia: código primeiro com shadcn, PO ajusta o design depois; leitura das pendências também da branch de intel aberta; Playwright como dependência de desenvolvimento). Pendente: a medição de tempo da triagem pelo PO (`docs/VALIDATION_SPRINT_2A_UI.md`) e a captura de tela no README, que dependem do PO usar a interface.
>
> Desvios registrados: os componentes shadcn foram escritos à mão seguindo as convenções do projeto (pasta `components/ui`, `cn()`, variantes com `class-variance-authority`) em vez de gerados pelo CLI do shadcn, para não depender de um passo interativo; o PO pode substituí-los pelos oficiais. O contador "decisões ainda não enviadas" depende de um remoto configurado. Antecipada em relação ao roadmap (a interface web estava na Sprint 3) porque a triagem por edição de JSON em pull request não serve ao revisor que o produto tem.
> Última atualização: 2026-10-27

Você é o Software Engineer responsável pelo Gateseeker. O stakeholder, Product Owner, Product Designer e auditor é o usuário humano, **que não é desenvolvedor**. As regras de trabalho, a stack e os controles de segurança das sprints anteriores continuam valendo.

## 1. Objetivo da sprint

Permitir que o revisor aprove ou rejeite propostas do feed de inteligência sem ler nem editar JSON, sem abrir um pull request, e sem perder nenhuma das garantias atuais: registro estruturado, revisor nomeado, data, fontes, validação por esquema e histórico em git.

A interface é a **primeira tela do produto** e nasce com a base de componentes decidida pelo PO (shadcn/ui ou equivalente headless com Tailwind). Ela também é o primeiro lugar onde o PO, como designer, pode trabalhar antes do código: o escopo aceita que as telas sejam desenhadas no Figma primeiro.

**Hipótese a validar:** o PO consegue triar um lote de 10 propostas em menos de 20 minutos, sem ajuda de engenharia, e o resultado é um commit válido em `advisories/`.

## 2. Princípios específicos

1. **Local e sem servidor na internet.** A interface roda na máquina do revisor (`gateseeker-intel ui`), lê e escreve os arquivos de `advisories/` e faz o commit no repositório local. Não há banco, login, nem exposição na rede. Push continua sendo um passo explícito.
2. **Linguagem simples.** Cada campo técnico tem um rótulo e uma frase de ajuda em português. Nada de `fixed_in` na tela; "a partir de qual versão está corrigido" sim.
3. **O revisor decide, a interface só facilita.** Rascunhos de resumo, tipo, gravidade e pacotes podem vir pré-preenchidos pela engenharia ou pelo coletor, sempre marcados como rascunho até o revisor confirmar campo a campo.
4. **Mesmas garantias do JSON.** Salvar só é possível quando o esquema valida. Aprovar exige duas fontes de editores distintos ou uma fonte primária, e grava revisor e data automaticamente a partir do usuário git configurado.
5. **Nada de IA decidindo.** A interface pode mostrar o texto da fonte em um painel lateral embutido (iframe da URL original), nunca um resumo gerado por modelo.

## 3. Escopo

### 3.1. Lista de pendências

Tela inicial com as propostas de `advisories/proposed/` (incluindo as que vierem em branches `intel/*` já mescladas ou, se o PO preferir, lidas direto da branch do PR aberto). Cada cartão mostra: título da fonte, editor e data, ecossistema e pacotes candidatos, gravidade proposta, e um selo "já coberto pelo OSV" quando a engenharia tiver verificado isso. Ordenação por data. Filtro por ecossistema e por editor.

### 3.2. Tela de revisão

Um registro por vez, em duas colunas: à esquerda o formulário em linguagem simples; à direita a fonte original aberta em um painel para leitura.

Campos, com rótulo e ajuda:

- **O que aconteceu** (tipo): escolha entre "versão maliciosa publicada", "tags reescritas", "conta de mantenedor comprometida", "pacote impostor (typosquat)", "script de instalação com backdoor", "outro".
- **Gravidade**: crítica, alta, moderada, baixa, com uma frase do que cada uma significa para quem instala.
- **Ecossistema** e **pacotes afetados**: lista editável; para cada pacote, "versões afetadas" (lista) ou "intervalo" (de, até), e "corrigido a partir de". Para Composer, "tags afetadas" e "commits depois de".
- **Janela**: início e fim, com "ainda em aberto" como opção explícita.
- **Resumo em uma linha** e **o que fazer**: campos de texto com contador de caracteres e lembrete de que devem ser escritos pelo revisor, não copiados.
- **Fontes**: lista com editor, título, data e link; botão "adicionar fonte". Indicador de quantos editores distintos há.
- **Indicadores**: lista opcional de fatos verificáveis.

Ações: **Aprovar**, **Rejeitar com motivo**, **Deixar para depois**. Aprovar e rejeitar movem o arquivo para a pasta certa, preenchem `review` com usuário git e data, validam pelo esquema e fazem um commit local por decisão, com mensagem padronizada. "Deixar para depois" só salva o rascunho.

### 3.3. Pré-preenchimento pela engenharia

Um comando `gateseeker-intel draft <id>` permite que a engenharia (ou um futuro extrator aprovado) grave rascunhos de campos num bloco `draft` do registro. A interface mostra rascunhos em destaque visual e exige confirmação por campo. O bloco `draft` é removido ao aprovar ou rejeitar e nunca é lido pelo scanner.

### 3.4. Histórico e estado

Aba com registros aprovados e rejeitados, data, revisor e motivo. Indicação de quantos commits locais ainda não foram enviados, com botão "enviar para o GitHub" que executa o push e, se houver, fecha o PR de intel correspondente.

### 3.5. Stack

- Servidor local em Node (já é a stack do produto), servindo uma aplicação React com Vite, Tailwind e shadcn/ui. Sem Next.js, para não trazer servidor de produção onde não há produção.
- Comunicação por HTTP local em porta aleatória, com token de sessão gerado a cada execução e passado na URL aberta no navegador, para que outra aba ou processo não consiga escrever nos arquivos.
- Operações de git via comandos `git` locais, somente `add`, `commit`, `push` e leitura de `config user.name`. Nenhuma operação destrutiva.
- Testes: Vitest para a API local e para a lógica de formulário; Playwright para o fluxo ponta a ponta aprovar e rejeitar, conforme previsto na stack desde a Sprint 0.

## 4. Fora de escopo

Autenticação, multiusuário, hospedagem, notificações, revisão por mais de uma pessoa ao mesmo tempo, edição de registros já aprovados (passa a ser `withdrawn` e novo registro), extração por IA.

## 5. Testes obrigatórios

1. Fluxo completo com as fixtures de `fixtures/intel/`: abrir pendência, preencher, aprovar, verificar arquivo em `approved/`, `review` preenchido, commit criado.
2. Rejeitar com motivo move para `rejected/` e grava o motivo.
3. Aprovar com uma única fonte de um só editor é bloqueado com mensagem clara.
4. Salvar com `summary` acima do limite é bloqueado com contador.
5. Requisição sem o token de sessão é recusada.
6. Nenhuma operação git além de `add`, `commit`, `push` e leitura de config é invocada (teste por injeção do executor de comandos).
7. Rascunho (`draft`) aparece destacado, exige confirmação e é removido ao decidir.
8. O scanner ignora qualquer bloco `draft` presente em um registro.

## 6. Critérios de aceite

- O PO tria o lote do PR #1 (10 propostas) usando apenas a interface, e o resultado passa no `gateseeker-intel validate` e no CI.
- Tempo medido da triagem registrado em `docs/VALIDATION_SPRINT_2A_UI.md`, junto com o que confundiu o revisor e o que foi ajustado.
- Playwright cobrindo aprovar e rejeitar.
- Documentação da interface no README com uma captura de tela.

## 7. Decisões que precisam do PO antes de começar

1. Aprovação deste escopo e da antecipação em relação à Sprint 3.
2. **Figma primeiro ou código primeiro.** Recomendo que o PO desenhe a tela de revisão no Figma antes, já que é designer e esta é a primeira tela do produto; a engenharia implementa a partir do desenho. Se preferir velocidade, a engenharia monta com os componentes padrão do shadcn e o PO ajusta depois.
3. Onde a interface lê as pendências: só de `advisories/proposed/` na branch atual (mais simples), ou também da branch do PR de intel aberto (evita um merge manual antes de triar). Recomendo a segunda, com a interface fazendo o merge local da branch `intel/*` ao iniciar.
4. Playwright entra como dependência de desenvolvimento (primeira vez no projeto).

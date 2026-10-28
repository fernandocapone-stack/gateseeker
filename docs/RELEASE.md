# Publicação: passo a passo para o PO

Roteiro da primeira publicação pública e das seguintes. Os passos marcados **[PO]** só você pode fazer. Atualizado em 2026-10-27 depois de confirmar, na documentação do npm, que a publicação confiável (trusted publishing) só pode ser configurada em um pacote que **já existe**; e que o npm está restringindo tokens que publicam sem 2FA. Por isso a primeira versão sai da sua máquina e as seguintes saem do CI com proveniência.

## Uma vez só

1. **[PO] Conta no npm com 2FA.** Feito em 2026-10-27 (usuário `fernandocapone`, autenticador no celular).
2. **[PO] Primeira publicação, da sua máquina**, com a engenharia disparando os comandos no seu terminal e você digitando só o que é seu:
   - `npm login`: o terminal mostra um endereço; aperte Enter, confirme no navegador (já logado), volte ao terminal.
   - `npm publish --access public --provenance false`: o npm pergunta o **código do autenticador** (seis dígitos); digite e confirme. Esta versão (`1.0.0-beta.1`) sai sem proveniência porque é construída fora do CI; é a única que ficará assim.
3. **[PO] Publicação confiável no pacote.** Em https://www.npmjs.com/package/gateseeker/access (ou Settings do pacote, "Trusted publishing"), adicione um publicador GitHub Actions com: **Organization or user** `fernandocapone-stack`, **Repository** `gateseeker`, **Workflow filename** `release.yml`, ambiente em branco. Salve. A configuração precisa concluir a primeira publicação bem-sucedida em até 2 dias, então o passo 4 vem logo em seguida.
4. Engenharia: publica `1.0.0-beta.2` pela tag `v1.0.0-beta.2`; o workflow `release.yml` publica com proveniência e cria a release no GitHub. A partir daí a tag `v1` e a Action apontam para uma versão com proveniência. Nenhum token fica guardado em lugar nenhum.
5. **[PO] Repositório público.** Em https://github.com/fernandocapone-stack/gateseeker/settings, "Danger Zone", "Change visibility". Necessário para que a Action seja usada por outros repositórios. Antes: revisão final do histórico (eu confirmo a cada commit que não há segredo real; a palavra final é sua), descrição e tópicos do repositório. A tagline provisória continua provisória.

## Opção para o futuro: publicação em etapas

O npm oferece a "publicação em etapas" (staged publishing): o CI prepara a versão e um humano com 2FA a conclui no site. É uma camada a mais, alinhada com o princípio do produto de que um humano aprova, ao custo de um clique seu a cada versão. Hoje o publicador confiável está com "Allow npm publish" marcado (publicação direta pelo CI). Se quiser mudar, basta desmarcar essa opção no npm e eu adapto o workflow.

## A cada versão

1. Engenharia: atualiza `version` em `package.json` e o `version` padrão em `action.yml` (iguais), atualiza o README se houver entradas novas, PR, CI verde, merge.
2. Engenharia: cria e envia a tag `vX.Y.Z` na main. `release.yml` roda `pnpm check` e os testes de navegador, confere que a tag bate com o `package.json`, confere a lista de arquivos do pacote, publica no npm com proveniência, cria a release no GitHub e move a tag flutuante `v1`.
3. PO: confere em https://www.npmjs.com/package/gateseeker que a versão apareceu com o selo "Provenance" e em https://github.com/fernandocapone-stack/gateseeker/releases que a release existe.

## Como alguém verifica a proveniência

```bash
npm audit signatures
```

num projeto que tenha o `gateseeker` instalado mostra que o pacote foi assinado e construído pelo workflow deste repositório a partir de um commit específico.

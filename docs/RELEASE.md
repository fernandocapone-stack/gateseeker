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

## Publicação em etapas (o modo adotado)

O CI não publica diretamente: ele **prepara** a versão no npm (`npm stage publish`), com proveniência assinada, e você a **aprova** com o autenticador. É o modo que o próprio npm recomenda e é coerente com o princípio do produto: um humano aprova. Esse modo é sempre permitido ao publicador confiável, independentemente das opções marcadas na tela de configuração. Decisão tomada em 2026-10-28 depois de a publicação direta pelo CI ser recusada pelo registro.

## A cada versão

1. Engenharia: atualiza `version` em `package.json` e o `version` padrão em `action.yml` (iguais), atualiza o README se houver entradas novas, PR, CI verde, merge.
2. Engenharia: cria e envia a tag `vX.Y.Z` na main. `release.yml` roda `pnpm check` e os testes de navegador, confere que a tag bate com o `package.json`, confere a lista de arquivos do pacote, **prepara** a versão no npm com proveniência, cria a release no GitHub e move a tag flutuante `v1`.
3. **[PO] Aprovar no npm.** Abra https://www.npmjs.com/package/gateseeker, aba **Staged Packages**, confira a versão e clique em **Approve**; confirme com o autenticador. Só então a versão fica instalável. Alternativa pela linha de comando: `npm stage list gateseeker` e `npm stage approve <id>`.
4. PO: confira que a versão apareceu com o selo "Provenance" na página do pacote e que a release existe em https://github.com/fernandocapone-stack/gateseeker/releases.

Versões `1.0.0-beta.2` a `1.0.0-beta.4` existem como tags no git mas nunca chegaram ao npm (o publicador confiável ainda não estava salvo no npm); a primeira versão preparada por este fluxo é a `1.0.0-beta.5`.

## Como alguém verifica a proveniência

```bash
npm audit signatures
```

num projeto que tenha o `gateseeker` instalado mostra que o pacote foi assinado e construído pelo workflow deste repositório a partir de um commit específico.

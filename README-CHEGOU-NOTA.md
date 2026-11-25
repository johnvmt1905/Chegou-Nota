# Chegou Nota — Omie → Slack

## Arquivos

- `index.js`: servidor, consulta à Omie, formatação Slack, fila e deduplicação.
- `package.json`: dependências e comando de inicialização.
- `.env.example`: modelo das variáveis de ambiente (não contém credenciais).

## Instalar

Use Node.js 22 ou 24. Execute `npm install` e `npm start`. No Coolify, publique os três arquivos e configure a inicialização `npm start` (ou preserve a configuração Docker existente, instalando as dependências).

Configure as variáveis indicadas em `.env.example` no painel do Coolify. Não cole segredos no repositório.

**Obrigatório:** monte armazenamento persistente do Coolify no diretório `/app/data`, se esse for o diretório de trabalho do contêiner. Confirme o caminho real: `DB_PATH` deve apontar para o volume montado. Sem volume, o histórico de deduplicação pode desaparecer em cada deploy.

**Obrigatório:** uma única instância do bot usando o banco SQLite; múltiplas réplicas exigem outro desenho de fila.

## Validação segura

1. Configure `DRY_RUN=true` e use um banco SQLite **separado** do banco de produção para o teste. Nesse modo, as notas ficam marcadas como enviadas no banco de teste sem publicar no Slack.
2. Com um evento de teste que contenha `topic=RecebimentoProduto.Incluido` e `event.cabecalho.nIdReceb` real, verifique se os logs exibem a mensagem completa.
3. Confira os campos de fornecedor, parcelas e itens.
4. Para produção, configure `DRY_RUN=false`, `DB_PATH` no volume persistente e habilite o webhook `RecebimentoProduto.Incluido` no Omie.
5. O botão `Abrir Omie` abre apenas a página configurada em `OMIE_URL` — não direciona para a NF-e específica. O botão DANFE só aparece se a consulta fornecer um link HTTPS nos campos contemplados pelo código; ainda precisamos validar a obtenção desse link para notas de fornecedores.

## Segurança e confiabilidade

- O endpoint atual considera o caminho `WEBHOOK_PATH` como um segredo operacional, mas **não autentica criptograficamente o remetente**. Recomenda-se uma URL imprevisível, restrições de rede quando viáveis e checagem das opções de autenticação do webhook Omie.
- A API Omie e o Slack podem falhar; a fila tenta novamente com intervalo progressivo.
- Se o processo reiniciar exatamente durante o envio ao Slack, uma linha pode ficar em `processing`. Revise no Slack antes de reprocessá-la manualmente; é uma proteção contra envios duplicados sob resultado incerto.
- Para inspecionar filas: `SELECT chave, status, tentativas, ultimo_erro FROM notificacoes;`.
- Não use `DRY_RUN=true` com o banco de produção: ele marca a nota como enviada sem publicar no canal.

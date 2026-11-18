
require('dotenv').config();

const { WebClient } = require('@slack/web-api');

const token = process.env.SLACK_BOT_TOKEN;
const channel = process.env.SLACK_CHANNEL_ID;

if (!token || !channel) {
  throw new Error('Configure SLACK_BOT_TOKEN e SLACK_CHANNEL_ID no .env');
}

const slack = new WebClient(token);

async function main() {
  const result = await slack.chat.postMessage({
    channel,
    text: 'Teste do Chegou-Nota: integração com Slack funcionando.'
  });

  console.log('Mensagem enviada:', result.ok);
}

main().catch((error) => {
  console.error('Erro ao enviar mensagem:', error.message);
  process.exitCode = 1;
});

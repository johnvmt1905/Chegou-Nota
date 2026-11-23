
require('dotenv').config();

const express = require('express');
const { WebClient } = require('@slack/web-api');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

if (!WEBHOOK_PATH || !WEBHOOK_PATH.startsWith('/')) {
  throw new Error('Configure WEBHOOK_PATH no arquivo .env');
}

if (!process.env.SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
  throw new Error('Configure SLACK_BOT_TOKEN e SLACK_CHANNEL_ID');
}

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'online' });
});

app.post(WEBHOOK_PATH, async (req, res) => {
  const { messageId, topic, event } = req.body;

  console.log('Webhook recebido:', {
    messageId,
    topic,
    event: JSON.stringify(event, null, 2)  
  });

  try {
    const result = await slack.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      text: [
        '🧾 *Chegou-Nota — Teste de integração*',
        '',
        `*Evento:* ${topic || 'Não informado'}`,
        `*Código:* ${event?.codigo ?? 'Não informado'}`,
        `*ID da mensagem:* ${messageId || 'Não informado'}`
      ].join('\n')
    });

    console.log('Notificação enviada ao Slack:', result.ok);

    return res.sendStatus(200);
  } catch (error) {
    console.error(
      'Erro ao enviar mensagem ao Slack:',
      error.data || error.message
    );

    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});

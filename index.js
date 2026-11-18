
require('dotenv').config();

const express = require('express');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH;

if (!WEBHOOK_PATH || !WEBHOOK_PATH.startsWith('/')) {
  throw new Error('Configure WEBHOOK_PATH no arquivo .env');
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'online' });
});

app.post(WEBHOOK_PATH, (req, res) => {
  const { messageId, topic, event } = req.body;

  console.log('Webhook recebido:', {
    messageId,
    topic,
    eventKeys: Object.keys(event || {})
  });

  // Responde rapidamente ao Omie.
  res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});

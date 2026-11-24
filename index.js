
require('dotenv').config();

const express = require('express');
const { WebClient } = require('@slack/web-api');

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

if (!WEBHOOK_PATH?.startsWith('/')) {
  throw new Error('Configure WEBHOOK_PATH no .env');
}

if (!process.env.SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
  throw new Error('Configure SLACK_BOT_TOKEN e SLACK_CHANNEL_ID');
}

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Utilitários

function primeiro(...valores) {
  return valores.find(
    v => v !== undefined && v !== null && v !== ''
  );
}

function seguro(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function moeda(valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }

  const numero = Number(valor);

  if (!Number.isFinite(numero)) return null;

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(numero);
}

function campo(nome, valor) {
  if (valor === undefined || valor === null || valor === '') {
    return null;
  }

  return {
    type: 'mrkdwn',
    text: `*${nome}*\n${seguro(valor)}`
  };
}

function urlConfiavel(valor) {
  if (typeof valor !== 'string' || !valor) return null;

  try {
    const url = new URL(valor);

    // Não aceitar links arbitrários vindos do webhook.
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'app.omie.com.br'
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

// Monta a notificação

function montarMensagem(payload) {
  const { messageId, topic, event = {} } = payload;

  const cabec = event.cabec || {};

  const numero = primeiro(
    event.numero,
    event.numero_nfe,
    event.nNumero,
    cabec.nNumero
  );

  const serie = primeiro(event.serie, cabec.cSerie);

  const fornecedor = primeiro(
    event.fornecedor,
    event.nome_fornecedor,
    event.razao_social,
    cabec.xNome
  );

  const cnpj = primeiro(
    event.cnpj,
    event.cnpj_fornecedor,
    cabec.cCNPJ_CPF
  );

  const valor = moeda(primeiro(
    event.valor_total,
    event.valor,
    event.vTotal,
    cabec.vTotal
  ));

  const emissao = primeiro(
    event.data_emissao,
    event.dataEmissao,
    cabec.dEmissao
  );

  const vencimento = primeiro(
    event.vencimento,
    event.data_vencimento
  );

  const projeto = primeiro(
    event.projeto,
    event.nome_projeto
  );

  const codigo = primeiro(
    event.codigo,
    event.nIdReceb,
    cabec.nIdReceb
  );

  const chave = primeiro(
    event.chave_nfe,
    event.cChaveNfe,
    cabec.cChaveNfe
  );

  // Só utilizar URL configurada ou previamente validada.
  const linkOmie = urlConfiavel(
    process.env.OMIE_NOTAS_URL
  );

  const titulo = numero
    ? `🧾 Nova nota fiscal de entrada — Nº ${seguro(numero)}`
    : '🧾 Nova nota fiscal de entrada';

  const campos = [
    campo('Fornecedor', fornecedor),
    campo('CNPJ', cnpj),
    campo('Número da NF-e', numero),
    campo('Série', serie),
    campo('Valor total', valor),
    campo('Data de emissão', emissao),
    campo('Vencimento', vencimento),
    campo('Projeto', projeto),
    campo('Código Omie', codigo)
  ].filter(Boolean);

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🧾 Nova nota fiscal de entrada'
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: valor
          ? `*${seguro(valor)}*\nUma nota fiscal de entrada foi registrada.`
          : 'Uma nota fiscal de entrada foi registrada.'
      }
    },
    { type: 'divider' }
  ];

  // Slack permite até 10 campos por section.
  if (campos.length) {
    blocks.push({
      type: 'section',
      fields: campos
    });
  }

  if (chave) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Chave NF-e:*\n\`${seguro(chave)}\``
      }
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '📌 *Financeiro*\nConfira os dados da nota e verifique o lançamento no contas a pagar.'
      }
    }
  );

  if (linkOmie) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🔗 Abrir Omie'
          },
          url: linkOmie,
          action_id: 'abrir_omie'
        }
      ]
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: [
          'GZero • Integração Omie',
          topic ? `Evento: ${seguro(topic)}` : null,
          messageId ? `ID: ${seguro(messageId)}` : null
        ].filter(Boolean).join(' | ').slice(0, 3000)
      }
    ]
  });

  return {
    text: titulo,
    blocks
  };
}

// Rotas

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'online' });
});

app.post(WEBHOOK_PATH, async (req, res) => {

  console.log('========== WEBHOOK RECEBIDO ==========');

  console.log('Content-Type:', req.headers['content-type']);

  console.log('Tipo do body:', typeof req.body);

  console.log('Campos recebidos:', Object.keys(req.body || {}));

  console.log('Body completo:', JSON.stringify(req.body, null, 2));

  console.log('======================================');

  const { messageId, topic, event } = req.body || {};

  console.log('Webhook recebido:', {
    messageId,
    topic,
    event: JSON.stringify(event, null, 2)
  });

  try {
    const mensagem = montarMensagem(req.body);

    const result = await slack.chat.postMessage({
      channel: SLACK_CHANNEL_ID,
      ...mensagem
    });

    console.log('Notificação enviada:', result.ok);

    return res.sendStatus(200);
  } catch (error) {
    console.error(
      'Erro ao processar webhook:',
      error.data || error.message
    );

    return res.sendStatus(500);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});

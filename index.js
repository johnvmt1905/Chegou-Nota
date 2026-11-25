require('dotenv').config();

const express = require('express');
const { WebClient } = require('@slack/web-api');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const env = process.env;
const PORT = Number(env.PORT || 3000);
const WEBHOOK_PATH = env.WEBHOOK_PATH;
const TOPIC = 'RecebimentoProduto.Incluido';
const INTERVAL_MS = 30_000;

for (const key of ['SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'OMIE_APP_KEY', 'OMIE_APP_SECRET']) {
  if (!env[key]) throw new Error(`Variável obrigatória ausente: ${key}`);
}
if (!WEBHOOK_PATH?.startsWith('/')) throw new Error('WEBHOOK_PATH deve começar com /');

const dbPath = path.resolve(env.DB_PATH || './data/chegou-nota.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS notificacoes (
  chave TEXT PRIMARY KEY,
  recebimento_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tentativas INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa INTEGER NOT NULL DEFAULT 0,
  slack_ts TEXT,
  ultimo_erro TEXT,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_em TEXT
);
`);

const app = express();
app.use(express.json({ limit: '1mb' }));
const slack = new WebClient(env.SLACK_BOT_TOKEN);

function escapeSlack(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function reais(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(number) : 'Não informado';
}
function campo(nome, valor) {
  return valor === undefined || valor === null || valor === '' ? null : {
    type: 'mrkdwn', text: `*${nome}*\n${escapeSlack(valor)}`
  };
}
function urlHttp(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
}

async function consultarOmie(call, endpoint, parametro) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`https://app.omie.com.br/api/v1/${endpoint}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        call, app_key: env.OMIE_APP_KEY, app_secret: env.OMIE_APP_SECRET,
        param: [parametro]
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || data.faultstring || data.faultcode) {
      throw new Error(`Omie ${response.status}: ${data.faultstring || data.faultcode || 'Erro HTTP'}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function detalhesRecebimento(id) {
  return consultarOmie('ConsultarRecebimento', 'produtos/recebimentonfe', {
    nIdReceb: Number(id)
  });
}

function montarMensagem(detalhes, original) {
  const cab = detalhes.cabec || {};
  const parcelas = detalhes.parcelas?.parcelasLista || [];
  const itens = detalhes.itensRecebimento || [];
  const valor = cab.nValorNFe ?? original.cabecalho.nValorNF;
  const numero = cab.cNumeroNFe || original.cabecalho.cNumeroNF;
  const fields = [
    campo('Fornecedor', cab.cRazaoSocial || cab.cNome),
    campo('CNPJ/CPF', cab.cCNPJ_CPF),
    campo('NF-e', `${numero || 'Não informado'} · Série ${cab.cSerieNFe || original.cabecalho.cSerie || '?'}`),
    campo('Emissão', cab.dEmissaoNFe || original.cabecalho.dDataEmissao),
    campo('Categoria', detalhes.infoAdicionais?.cCategCompra || original.cabecalho.cCodCateg),
    campo('Projeto (ID Omie)', detalhes.infoAdicionais?.nIdProjeto),
  ].filter(Boolean);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '🧾 Nova NF-e de fornecedor' } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${escapeSlack(reais(valor))}*\nNova nota capturada pelo Omie para a GZero.` } },
    { type: 'divider' },
    { type: 'section', fields },
  ];

  if (parcelas.length) {
    const linhas = parcelas.slice(0, 10).map((p, index) =>
      `• ${index + 1}ª parcela: *${escapeSlack(reais(p.vParcela))}* — vencimento ${escapeSlack(p.dVencimento || 'não informado')}`
    );
    if (parcelas.length > 10) linhas.push(`• E mais ${parcelas.length - 10} parcelas`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*💳 Financeiro*\n${linhas.join('\n')}` } });
  }

  if (itens.length) {
    const linhas = itens.slice(0, 5).map(item => {
      const dados = item.itensCabec || {};
      return `• ${escapeSlack(dados.cDescricaoProduto || 'Produto')} (${escapeSlack(dados.nQtdeNFe ?? '?')} un.)`;
    });
    if (itens.length > 5) linhas.push(`• E mais ${itens.length - 5} itens`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*📦 Itens*\n${linhas.join('\n')}` } });
  }

  if (cab.cChaveNFe) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Chave NF-e: \`${escapeSlack(cab.cChaveNFe)}\`` }] });
  }

  // Não presumir que links de documentos emitidos pela GZero funcionem para NF-e de fornecedores.
  const pdf = urlHttp(detalhes.cPdf || detalhes.cDanfe || detalhes.linkDanfe);
  const omie = urlHttp(env.OMIE_URL);
  const buttons = [];
  if (pdf) buttons.push({ type: 'button', text: { type: 'plain_text', text: '📄 Ver DANFE' }, url: pdf, action_id: 'ver_danfe' });
  if (omie) buttons.push({ type: 'button', text: { type: 'plain_text', text: '🔗 Abrir Omie' }, url: omie, action_id: 'abrir_omie' });
  if (buttons.length) blocks.push({ type: 'actions', elements: buttons });

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `GZero · Recebimento Omie #${escapeSlack(cab.nIdReceb || original.cabecalho.nIdReceb)}` }] });

  return { text: `NF-e ${numero || '?'} — ${reais(valor)}`, blocks };
}

const inserir = db.prepare(`INSERT OR IGNORE INTO notificacoes
  (chave, recebimento_id, payload) VALUES (?, ?, ?)`);
const pendentes = db.prepare(`SELECT * FROM notificacoes
  WHERE status = 'pending' AND proxima_tentativa <= ? ORDER BY criado_em ASC LIMIT 10`);
const marcarProcessando = db.prepare(`UPDATE notificacoes SET status = 'processing', tentativas = tentativas + 1 WHERE chave = ? AND status = 'pending'`);
const marcarEnviado = db.prepare(`UPDATE notificacoes SET status = 'sent', slack_ts = ?, enviado_em = CURRENT_TIMESTAMP, ultimo_erro = NULL WHERE chave = ?`);
const marcarPendente = db.prepare(`UPDATE notificacoes SET status = 'pending', proxima_tentativa = ?, ultimo_erro = ? WHERE chave = ?`);

let executando = false;
async function processarFila() {
  if (executando) return;
  executando = true;
  try {
    for (const row of pendentes.all(Date.now())) {
      if (!marcarProcessando.run(row.chave).changes) continue;
      try {
        const detalhes = await detalhesRecebimento(row.recebimento_id);
        const mensagem = montarMensagem(detalhes, JSON.parse(row.payload));
        if (env.DRY_RUN === 'true') {
          console.log('DRY_RUN: mensagem montada', JSON.stringify(mensagem, null, 2));
          marcarEnviado.run('dry-run', row.chave);
          continue;
        }
        const result = await slack.chat.postMessage({ channel: env.SLACK_CHANNEL_ID, ...mensagem });
        marcarEnviado.run(result.ts || '', row.chave);
        console.log('NF-e notificada:', row.recebimento_id, 'Slack:', result.ts);
      } catch (error) {
        const waitMs = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(row.tentativas, 6));
        marcarPendente.run(Date.now() + waitMs, String(error.message).slice(0, 300), row.chave);
        console.error('Falha ao processar nota:', row.recebimento_id, error.message);
      }
    }
  } finally {
    executando = false;
  }
}

app.get('/health', (_req, res) => res.json({ status: 'online' }));

app.post(WEBHOOK_PATH, (req, res) => {
  const payload = req.body;
  if (payload?.topic !== TOPIC) {
    console.log('Evento ignorado:', payload?.topic || '(sem tópico)');
    return res.sendStatus(200);
  }
  const id = payload.event?.cabecalho?.nIdReceb;
  if (!Number.isSafeInteger(id) || id <= 0) {
    console.warn('Evento sem nIdReceb válido:', Object.keys(payload.event || {}));
    return res.sendStatus(400);
  }
  // O ID interno é único por empresa; appKey separa eventuais contas distintas.
  const empresa = payload.appKey || env.OMIE_APP_KEY;
  const chave = `${empresa}:${id}`;
  const result = inserir.run(chave, String(id), JSON.stringify(payload.event));
  console.log(result.changes ? 'Evento enfileirado:' : 'Evento duplicado ignorado:', id);
  res.sendStatus(200);
  setImmediate(() => processarFila().catch(error => console.error('Erro fila:', error)));
});

// Se o processo cair após enviar ao Slack mas antes de registrar o resultado,
// o status 'processing' fica retido para revisão manual, evitando reenvio cego.
const emProcessamento = db.prepare("SELECT chave, recebimento_id FROM notificacoes WHERE status = 'processing'").all();
if (emProcessamento.length) {
  console.warn('Envios com estado incerto (revisar no Slack antes de repetir):', emProcessamento);
}

setInterval(() => processarFila().catch(console.error), INTERVAL_MS).unref();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chegou Nota: porta ${PORT}, banco ${dbPath}, DRY_RUN=${env.DRY_RUN === 'true'}`);
  processarFila().catch(console.error);
});

// src/index.js
require('dotenv').config();
const express = require('express');
const config = require('./config');
const { processarMensagem } = require('./agent');
const { downloadMedia, transcreverAudio, analisarImagem } = require('./media');
const { enviarTexto, marcarLida, digitando } = require('./evolution');
const { uploadImagem } = require('./tools/memorando');
const { iniciarScheduler } = require('./scheduler');

const app = express();
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    agent: 'cobertex-agent',
    instance: config.EVOLUTION_INSTANCE,
    timestamp: new Date().toISOString(),
  });
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const payload = req.body;
    const evento = (payload.event || '').toLowerCase();
    console.log('[webhook] Evento:', evento, '| Sender:', payload.sender);

    if (evento !== 'messages.upsert') return;

    const message =
      payload.data?.message ||
      payload.data?.messages?.[0] ||
      payload.data;

    if (!message) return;

    const fromMe = message.key?.fromMe || payload.data?.key?.fromMe;
    if (fromMe) return;

    const jid =
      message.key?.remoteJid ||
      payload.data?.key?.remoteJid ||
      payload.sender || '';

    const numero = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^0-9]/g, '');
    if (!numero) return;

    console.log(`[webhook] Número: ${numero}`);

    const usuario = config.USUARIOS[numero];
    if (!usuario) {
      console.log(`[webhook] Não autorizado: ${numero}`);
      await enviarTexto(numero, '⚠️ Número não autorizado. Fale com Robinson.');
      return;
    }

    console.log(`[webhook] Usuário: ${usuario.nome}`);

    const messageKey = message.key || payload.data?.key;
    if (messageKey) await marcarLida(numero, messageKey);

    const messageContent = message.message || payload.data?.message || {};
    const messageType = Object.keys(messageContent)[0] || '';
    console.log(`[webhook] Tipo: ${messageType}`);

    let textoFinal = '';
    let descricaoImagem = null;
    let imagemUrl = null;

    if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
      textoFinal =
        messageContent?.conversation ||
        messageContent?.extendedTextMessage?.text || '';

    } else if (messageType === 'audioMessage' || messageType === 'pttMessage') {
      await digitando(numero, 3000);
      const base64Audio = await downloadMedia(messageKey, config.EVOLUTION_INSTANCE);
      if (base64Audio) {
        const mimeType = messageContent?.audioMessage?.mimetype || 'audio/ogg; codecs=opus';
        textoFinal = await transcreverAudio(base64Audio, mimeType);
        console.log(`[webhook] Transcrição: ${textoFinal}`);
        textoFinal = `[Mensagem de áudio transcrita]: ${textoFinal}`;
      } else {
        await enviarTexto(numero, '⚠️ Não consegui processar o áudio. Tente em texto.');
        return;
      }

    } else if (messageType === 'imageMessage') {
      await digitando(numero, 2000);
      const base64Img = await downloadMedia(messageKey, config.EVOLUTION_INSTANCE);
      const caption = messageContent?.imageMessage?.caption || '';
      const mimeType = messageContent?.imageMessage?.mimetype || 'image/jpeg';
      if (base64Img) {
        imagemUrl = await uploadImagem(base64Img, mimeType);
        descricaoImagem = await analisarImagem(base64Img, mimeType, caption || undefined);
        textoFinal = caption || '(imagem enviada sem legenda)';
      } else {
        await enviarTexto(numero, '⚠️ Não consegui processar a imagem.');
        return;
      }

    } else if (messageType === 'documentMessage') {
      await enviarTexto(numero, '📎 Arquivo recebido! Diga o contexto para eu anexar ao memorando.');
      return;

    } else {
      console.log(`[webhook] Tipo não suportado: ${messageType}`);
      return;
    }

    if (!textoFinal && !descricaoImagem) return;

    await digitando(numero, 4000);

    const { resposta, notificarRobinson } = await processarMensagem({
      numero,
      usuario,
      texto: textoFinal,
      imagemUrl,
      descricaoImagem,
    });

    await enviarTexto(numero, resposta);

    if (notificarRobinson && numero !== config.ROBINSON_NUMBER) {
      await enviarTexto(config.ROBINSON_NUMBER,
        `🔔 *Solicitação fora do escopo*\n\n👤 ${notificarRobinson.solicitante}\n📋 ${notificarRobinson.descricao}\n\n_Assistente Cobertex_`
      );
    }

  } catch (err) {
    console.error('[webhook] Erro:', err.message);
    console.error(err.stack);
  }
});

app.listen(config.PORT, () => {
  console.log(`\n🏗️  Cobertex Agent rodando na porta ${config.PORT}`);
  console.log(`📱 Instância Evolution: ${config.EVOLUTION_INSTANCE}`);
  console.log(`🔗 Base44 App: ${config.BASE44_APP_ID}`);
  console.log(`\n👥 Usuários:`);
  for (const [num, usr] of Object.entries(config.USUARIOS)) {
    console.log(`   ${num} → ${usr.nome} (${usr.role})${usr.diretor ? ` | agenda: ${usr.diretor}` : ''}`);
  }
  console.log('');

  // Inicia o scheduler de lembretes e resumos
  iniciarScheduler();
});

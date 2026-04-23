// src/index.js
require('dotenv').config();
const express = require('express');
const config = require('./config');
const { processarMensagem } = require('./agent');
const { downloadMedia, transcreverAudio, analisarImagem, gerarAudio } = require('./media');
const { enviarTexto, enviarAudio, marcarLida, digitando } = require('./evolution');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    agent: 'cobertex-agent',
    instance: config.EVOLUTION_INSTANCE,
    timestamp: new Date().toISOString(),
  });
});

// ─── Webhook da Evolution API ─────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  // Responde imediatamente para evitar timeout da Evolution
  res.sendStatus(200);

  try {
    const payload = req.body;
console.log('[webhook] Evento:', payload.event, JSON.stringify(Object.keys(payload)));

    // Ignora eventos que não são mensagens recebidas
    const evento = (payload.event || '').toLowerCase();
if (evento !== 'messages.upsert') return;

    const message = payload.data?.messages?.[0];
    if (!message) return;

    // Ignora mensagens enviadas por nós mesmos
    if (message.key?.fromMe) return;

    // Extrai número do remetente
    const jid = message.key?.remoteJid || '';
    const numero = jid.replace('@s.whatsapp.net', '').replace('@c.us', '');

    // Verifica se o número está autorizado
    const usuario = config.USUARIOS[numero];
    if (!usuario) {
      console.log(`[webhook] Número não autorizado: ${numero}`);
      await enviarTexto(
        numero,
        '⚠️ Desculpe, este número não está autorizado a usar o assistente Cobertex.\n' +
        'Entre em contato com Robinson para solicitar acesso.'
      );
      return;
    }

    // Marca como lida
    await marcarLida(numero, message.key);

    const messageType = Object.keys(message.message || {})[0];
    let textoFinal = '';
    let descricaoImagem = null;
    let imagemBase64 = null;

    console.log(`[webhook] Mensagem de ${usuario.nome} (${numero}): tipo=${messageType}`);

    // ── Processa por tipo de mensagem ──────────────────────────────────────

    if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
      // Mensagem de texto simples
      textoFinal =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        '';

    } else if (messageType === 'audioMessage' || messageType === 'pttMessage') {
      // Áudio / nota de voz
      await digitando(numero, 3000);

      const base64Audio = await downloadMedia(message.key, config.EVOLUTION_INSTANCE);
      if (base64Audio) {
        const mimeType = message.message?.audioMessage?.mimetype || 'audio/ogg; codecs=opus';
        textoFinal = await transcreverAudio(base64Audio, mimeType);
        console.log(`[webhook] Transcrição: ${textoFinal}`);

        // Prefixo para o Claude saber que veio de áudio
        textoFinal = `[Mensagem de áudio transcrita]: ${textoFinal}`;
      } else {
        await enviarTexto(numero, '⚠️ Não consegui processar o áudio. Tente enviar em texto.');
        return;
      }

    } else if (messageType === 'imageMessage') {
      // Imagem
      await digitando(numero, 2000);

      const base64Img = await downloadMedia(message.key, config.EVOLUTION_INSTANCE);
      const caption = message.message?.imageMessage?.caption || '';
      const mimeType = message.message?.imageMessage?.mimetype || 'image/jpeg';

      if (base64Img) {
        imagemBase64 = base64Img;
        descricaoImagem = await analisarImagem(base64Img, mimeType, caption || undefined);
        textoFinal = caption || '(imagem enviada sem legenda)';
      } else {
        await enviarTexto(numero, '⚠️ Não consegui processar a imagem. Tente novamente.');
        return;
      }

    } else if (messageType === 'documentMessage') {
      await enviarTexto(
        numero,
        '📎 Recebi seu arquivo! No momento só processo imagens e áudios diretamente.\n' +
        'Se precisar anexar este documento a um memorando, me informe o contexto.'
      );
      return;

    } else {
      // Tipo não suportado
      console.log(`[webhook] Tipo de mensagem não suportado: ${messageType}`);
      return;
    }

    if (!textoFinal && !descricaoImagem) return;

    // ── Indicador de digitando ─────────────────────────────────────────────
    await digitando(numero, 4000);

    // ── Processa com o agente ──────────────────────────────────────────────
    const { resposta, notificarRobinson } = await processarMensagem({
      numero,
      usuario,
      texto: textoFinal,
      imagemBase64,
      imagemMimeType: messageType === 'imageMessage'
        ? (message.message?.imageMessage?.mimetype || 'image/jpeg')
        : null,
      descricaoImagem,
    });

    // ── Envia resposta ─────────────────────────────────────────────────────

    // Tenta gerar áudio se a resposta for curta o suficiente (< 500 chars)
    // e se o usuário enviou áudio (responde em áudio)
    const deveResponderEmAudio =
      (messageType === 'audioMessage' || messageType === 'pttMessage') &&
      resposta.length < 500 &&
      config.ELEVENLABS_API_KEY;

    if (deveResponderEmAudio) {
      const audioBuffer = await gerarAudio(resposta);
      if (audioBuffer) {
        await enviarAudio(numero, audioBuffer);
      } else {
        await enviarTexto(numero, resposta);
      }
    } else {
      await enviarTexto(numero, resposta);
    }

    // ── Notifica Robinson se necessário ───────────────────────────────────
    if (notificarRobinson && numero !== config.ROBINSON_NUMBER) {
      const msgRobinson =
        `🔔 *Solicitação fora do escopo*\n\n` +
        `👤 Solicitante: ${notificarRobinson.solicitante}\n` +
        `📋 Descrição: ${notificarRobinson.descricao}\n\n` +
        `_Enviado automaticamente pelo assistente Cobertex_`;
      await enviarTexto(config.ROBINSON_NUMBER, msgRobinson);
    }

  } catch (err) {
    console.error('[webhook] Erro não tratado:', err);
  }
});

// ─── Inicia servidor ──────────────────────────────────────────────────────────

app.listen(config.PORT, () => {
  console.log(`\n🏗️  Cobertex Agent rodando na porta ${config.PORT}`);
  console.log(`📱 Instância Evolution: ${config.EVOLUTION_INSTANCE}`);
  console.log(`🔗 Base44 App: ${config.BASE44_APP_ID}`);
  console.log(`\n👥 Usuários configurados:`);
  for (const [num, usr] of Object.entries(config.USUARIOS)) {
    console.log(`   ${num} → ${usr.nome} (${usr.role}) | user_id: ${usr.user_id || '⚠️ NÃO CONFIGURADO'}`);
  }
  console.log('\n✅ Aguardando webhooks...\n');
});

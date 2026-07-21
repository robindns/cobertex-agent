// src/index.js
require('dotenv').config();
const express = require('express');
const config = require('./config');
const { processarMensagem } = require('./agent');
const { downloadMedia, transcreverAudio, analisarImagem } = require('./media');
const { enviarTexto, enviarDocumento, marcarLida, digitando } = require('./evolution');
const { uploadMidia, tamanhoMB } = require('./tools/storage');
const { gerarPDFBuffer } = require('./tools/relatorio');
const { iniciarScheduler } = require('./scheduler');
const { iniciarMonitor } = require('./monitor');

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

    const usuario = config.USUARIOS[numero];
    if (!usuario) {
      await enviarTexto(numero,
        `⚠️ Número não autorizado.\n\nPara acesso ao assistente Cobertex fale com Robinson.\n🔗 ${config.SISTEMA_URL}`
      );
      return;
    }

    console.log(`[webhook] ${usuario.nome} (${numero})`);

    const messageKey = message.key || payload.data?.key;
    if (messageKey) await marcarLida(numero, messageKey);

    const messageContent = message.message || payload.data?.message || {};
    const messageType = Object.keys(messageContent)[0] || '';
    console.log(`[webhook] Tipo: ${messageType}`);

    let textoFinal = '';
    let descricaoImagem = null;
    let midiaUrl = null;
    let midiaInfo = null;

    // ── Texto ──────────────────────────────────────────────────────────────
    if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
      textoFinal =
        messageContent?.conversation ||
        messageContent?.extendedTextMessage?.text || '';

    // ── Áudio ──────────────────────────────────────────────────────────────
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

    // ── Imagem ─────────────────────────────────────────────────────────────
    } else if (messageType === 'imageMessage') {
      await digitando(numero, 2000);
      const base64Img = await downloadMedia(messageKey, config.EVOLUTION_INSTANCE);
      const caption = messageContent?.imageMessage?.caption || '';
      const mimeType = messageContent?.imageMessage?.mimetype || 'image/jpeg';

      if (base64Img) {
        const mb = tamanhoMB(base64Img);
        console.log(`[webhook] Imagem: ${mb.toFixed(2)}MB`);

        // Upload ImgBB
        midiaUrl = await uploadMidia(base64Img, mimeType);
        midiaInfo = { tipo: 'imagem', mimeType, tamanhoMB: mb.toFixed(2) };

        // Analisa com Claude Vision
        descricaoImagem = await analisarImagem(base64Img, mimeType, caption || undefined);
        textoFinal = caption || '(imagem enviada sem legenda)';
      } else {
        await enviarTexto(numero, '⚠️ Não consegui processar a imagem.');
        return;
      }

    // ── Documento ──────────────────────────────────────────────────────────
    } else if (messageType === 'documentMessage') {
      const mimeType = messageContent?.documentMessage?.mimetype || 'application/pdf';
      const fileName = messageContent?.documentMessage?.fileName || 'documento';
      const caption = messageContent?.documentMessage?.caption || '';
      const fileLength = messageContent?.documentMessage?.fileLength || 0;
      const mb = fileLength / (1024 * 1024);

      if (mb > 5) {
        await enviarTexto(numero,
          `⚠️ Arquivo muito grande (${mb.toFixed(1)}MB). Limite é 5MB.\n\nSuba diretamente pelo sistema:\n🔗 ${config.SISTEMA_URL}`
        );
        return;
      }

      // ImgBB não suporta documentos — orienta o usuário
      await enviarTexto(numero,
        `📎 Recebi o documento *${fileName}*.\n\nNo momento não consigo anexar documentos automaticamente. Para salvar no sistema, acesse:\n🔗 ${config.SISTEMA_URL}`
      );
      textoFinal = caption || `(documento enviado: ${fileName})`;
      midiaInfo = { tipo: 'documento', fileName };

    // ── Vídeo ──────────────────────────────────────────────────────────────
    } else if (messageType === 'videoMessage') {
      const fileLength = messageContent?.videoMessage?.fileLength || 0;
      const mb = fileLength / (1024 * 1024);

      if (mb > 5) {
        await enviarTexto(numero,
          `⚠️ Vídeo muito grande (~${mb.toFixed(1)}MB). Limite é 5MB.\n\nEnvie pelo sistema:\n🔗 ${config.SISTEMA_URL}`
        );
        return;
      }

      await digitando(numero, 2000);
      const base64Video = await downloadMedia(messageKey, config.EVOLUTION_INSTANCE);
      const caption = messageContent?.videoMessage?.caption || '';

      if (base64Video) {
        const tamanho = tamanhoMB(base64Video);
        if (tamanho > 5) {
          await enviarTexto(numero, `⚠️ Vídeo muito grande (${tamanho.toFixed(1)}MB). Limite é 5MB.\n🔗 ${config.SISTEMA_URL}`);
          return;
        }
        // ImgBB não suporta vídeo — registra o envio como texto
        textoFinal = caption || '(vídeo enviado — não é possível armazenar automaticamente)';
        midiaInfo = { tipo: 'video', tamanhoMB: tamanho.toFixed(2) };
      } else {
        await enviarTexto(numero, '⚠️ Não consegui processar o vídeo.');
        return;
      }

    } else {
      console.log(`[webhook] Tipo não suportado: ${messageType}`);
      return;
    }

    if (!textoFinal && !descricaoImagem && !midiaUrl) return;

    await digitando(numero, 4000);

    const { resposta, notificarRobinson, pdfPendente } = await processarMensagem({
      numero,
      usuario,
      texto: textoFinal,
      midiaUrl,
      midiaInfo,
      descricaoImagem,
    });

    // Envia PDF se o agente solicitou
    if (pdfPendente) {
      try {
        const pdfBuffer = await gerarPDFBuffer(pdfPendente);
        const nomeArquivo = `${pdfPendente.titulo.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
        await enviarDocumento(numero, pdfBuffer, nomeArquivo);
        console.log(`[webhook] PDF enviado: ${nomeArquivo}`);
      } catch (err) {
        console.error('[webhook] Erro ao gerar PDF:', err.message);
        await enviarTexto(numero, '⚠️ Não consegui gerar o PDF. Tente novamente.');
      }
    }

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
  console.log(`🖼️  ImgBB: ${config.IMGBB_API_KEY ? '✅ configurado' : '⚠️ não configurado'}`);
  console.log(`\n👥 Usuários:`);
  for (const [num, usr] of Object.entries(config.USUARIOS)) {
    console.log(`   ${num} → ${usr.nome} (${usr.role})${usr.diretor ? ` | agenda: ${usr.diretor}` : ''}`);
  }
  console.log('');
  iniciarScheduler();
  iniciarMonitor();
});

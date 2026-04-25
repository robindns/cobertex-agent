// src/evolution.js
const axios = require('axios');
const config = require('./config');

const evClient = axios.create({
  baseURL: config.EVOLUTION_API_URL,
  headers: { apikey: config.EVOLUTION_API_KEY },
  timeout: 15000,
});

async function enviarTexto(numero, texto) {
  try {
    await evClient.post(`/message/sendText/${config.EVOLUTION_INSTANCE}`, {
      number: numero,
      text: texto,
    });
  } catch (err) {
    console.error('[evolution] Erro texto:', err.response?.data || err.message);
  }
}

async function enviarAudio(numero, audioBuffer) {
  try {
    const base64 = audioBuffer.toString('base64');
    await evClient.post(`/message/sendMedia/${config.EVOLUTION_INSTANCE}`, {
      number: numero,
      mediatype: 'audio',
      mimetype: 'audio/mpeg',
      media: base64,
      fileName: 'resposta.mp3',
    });
  } catch (err) {
    console.error('[evolution] Erro áudio:', err.response?.data || err.message);
  }
}

async function enviarImagem(numero, base64Img, legenda = '') {
  try {
    await evClient.post(`/message/sendMedia/${config.EVOLUTION_INSTANCE}`, {
      number: numero,
      mediatype: 'image',
      mimetype: 'image/jpeg',
      media: base64Img,
      caption: legenda,
    });
  } catch (err) {
    console.error('[evolution] Erro imagem:', err.response?.data || err.message);
  }
}

async function enviarDocumento(numero, buffer, fileName, mimetype = 'application/pdf') {
  try {
    const base64 = buffer.toString('base64');
    await evClient.post(`/message/sendMedia/${config.EVOLUTION_INSTANCE}`, {
      number: numero,
      mediatype: 'document',
      mimetype,
      media: base64,
      fileName,
    });
  } catch (err) {
    console.error('[evolution] Erro documento:', err.response?.data || err.message);
  }
}

async function marcarLida(numero, messageKey) {
  try {
    await evClient.post(`/chat/markMessageAsRead/${config.EVOLUTION_INSTANCE}`, {
      readMessages: [messageKey],
    });
  } catch (_) {}
}

async function digitando(numero, duracaoMs = 2000) {
  try {
    await evClient.post(`/chat/sendPresence/${config.EVOLUTION_INSTANCE}`, {
      number: numero,
      options: { presence: 'composing', delay: duracaoMs },
    });
  } catch (_) {}
}

module.exports = { enviarTexto, enviarAudio, enviarImagem, enviarDocumento, marcarLida, digitando };

/**
 * Envia mensagem de texto para qualquer número autorizado
 */
async function enviarMensagemParaUsuario(numero, texto) {
  return enviarTexto(numero, texto);
}

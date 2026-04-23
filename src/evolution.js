// src/evolution.js
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');

const evClient = axios.create({
  baseURL: config.EVOLUTION_API_URL,
  headers: { apikey: config.EVOLUTION_API_KEY },
  timeout: 15000,
});

/**
 * Envia mensagem de texto
 */
async function enviarTexto(numero, texto) {
  try {
    await evClient.post(`/message/sendText/${config.EVOLUTION_INSTANCE}`, {
      number: numero,
      text: texto,
    });
  } catch (err) {
    console.error('[evolution] Erro ao enviar texto:', err.response?.data || err.message);
  }
}

/**
 * Envia áudio (Buffer MP3) como mensagem de voz
 */
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
    console.error('[evolution] Erro ao enviar áudio:', err.response?.data || err.message);
  }
}

/**
 * Envia imagem com legenda
 */
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
    console.error('[evolution] Erro ao enviar imagem:', err.response?.data || err.message);
  }
}

/**
 * Marca mensagem como lida (typing indicator)
 */
async function marcarLida(numero, messageKey) {
  try {
    await evClient.post(`/chat/markMessageAsRead/${config.EVOLUTION_INSTANCE}`, {
      readMessages: [messageKey],
    });
  } catch (_) {}
}

/**
 * Envia presença "digitando..."
 */
async function digitando(numero, duracaoMs = 2000) {
  try {
    await evClient.post(`/chat/sendPresence/${config.EVOLUTION_INSTANCE}`, {
      number: numero,
      options: { presence: 'composing', delay: duracaoMs },
    });
  } catch (_) {}
}

module.exports = { enviarTexto, enviarAudio, enviarImagem, marcarLida, digitando };

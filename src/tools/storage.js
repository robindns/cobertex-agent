// src/tools/storage.js — Upload de imagens via ImgBB (gratuito)
const axios = require('axios');
const config = require('../config');

/**
 * Faz upload de imagem no ImgBB e retorna URL pública permanente
 */
async function uploadMidia(base64Data, mimeType = 'image/jpeg') {
  try {
    if (!config.IMGBB_API_KEY) {
      console.warn('[storage] IMGBB_API_KEY não configurada');
      return null;
    }

    // ImgBB só aceita imagens
    const isImagem = mimeType.startsWith('image/');
    if (!isImagem) {
      console.log('[storage] ImgBB não suporta este tipo:', mimeType);
      return null;
    }

    const FormData = require('form-data');
    const form = new FormData();
    form.append('image', base64Data);
    form.append('name', `cobertex_${Date.now()}`);

    const res = await axios.post(
      `https://api.imgbb.com/1/upload?key=${config.IMGBB_API_KEY}`,
      form,
      { headers: form.getHeaders(), timeout: 30000 }
    );

    const url = res.data?.data?.display_url || res.data?.data?.url;
    console.log('[storage] ImgBB upload OK:', url);
    return url;

  } catch (err) {
    console.error('[storage] Erro ImgBB:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Verifica tamanho do base64 em MB
 */
function tamanhoMB(base64) {
  return (base64.length * 0.75) / (1024 * 1024);
}

module.exports = { uploadMidia, tamanhoMB };

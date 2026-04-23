// src/tools/memorando.js
const base44 = require('../base44');
const axios = require('axios');
const config = require('../config');

/**
 * Faz upload de imagem no Base44 e retorna URL pública
 * Base44 aceita upload via multipart/form-data no endpoint de arquivos
 */
async function uploadImagem(base64Data, mimeType = 'image/jpeg') {
  try {
    const FormData = require('form-data');
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : 'jpg';
    const filename = `memorando_${Date.now()}.${ext}`;

    const form = new FormData();
    form.append('file', buffer, { filename, contentType: mimeType });

    const res = await axios.post(
      `${config.BASE44_BASE_URL}/upload`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'api_key': config.BASE44_API_KEY,
        },
        timeout: 30000,
      }
    );

    const url = res.data?.url || res.data?.file_url || res.data?.path;
    if (url) {
      console.log('[memorando] Upload OK:', url);
      return url;
    }

    // Se Base44 não tiver endpoint de upload, retorna data URL como fallback
    console.log('[memorando] Upload sem URL, usando data URL');
    return `data:${mimeType};base64,${base64Data.substring(0, 50)}...`;
  } catch (err) {
    console.error('[memorando] Erro no upload:', err.response?.data || err.message);
    // Fallback: retorna null, imagem não será anexada mas memorando será criado
    return null;
  }
}

/**
 * Cria um memorando no sistema Cobertex
 */
async function criarMemorando({ titulo, conteudo, criador_id, cliente_id, instalacao_id, urgente, tags, anexos }) {
  const hoje = new Date().toISOString().split('T')[0];

  const payload = {
    titulo: titulo || 'Relato operacional',
    conteudo_transcrito: conteudo,
    data: hoje,
    criador_id,
    urgente: urgente || false,
    status: 'pendente',
  };

  if (cliente_id) payload.cliente_id = cliente_id;
  if (instalacao_id) payload.instalacao_id = instalacao_id;
  if (tags && tags.length) payload.tags = tags;
  if (anexos && anexos.length) payload.anexos = anexos;

  const resultado = await base44.create('Memorando', payload);
  return resultado;
}

/**
 * Lista memorandos recentes
 */
async function listarMemorandos({ cliente_id, status, limit = 20 } = {}) {
  const query = {};
  if (cliente_id) query.cliente_id = cliente_id;
  if (status) query.status = status;
  return base44.list('Memorando', query, limit);
}

/**
 * Atualiza um memorando existente (ex: adicionar anexos)
 */
async function atualizarMemorando({ memorando_id, campos }) {
  return base44.update('Memorando', memorando_id, campos);
}

/**
 * Adiciona imagens/anexos a um memorando existente
 */
async function adicionarAnexos({ memorando_id, novos_anexos }) {
  // Busca memorando atual para preservar anexos existentes
  const memorando = await base44.get('Memorando', memorando_id);
  const anexosAtuais = memorando.anexos || [];
  const todosAnexos = [...anexosAtuais, ...novos_anexos].filter(Boolean);
  return base44.update('Memorando', memorando_id, { anexos: todosAnexos });
}

/**
 * Marca memorando como concluído
 */
async function concluirMemorando({ memorando_id }) {
  return base44.update('Memorando', memorando_id, { status: 'concluido' });
}

module.exports = {
  uploadImagem,
  criarMemorando,
  listarMemorandos,
  atualizarMemorando,
  adicionarAnexos,
  concluirMemorando,
};

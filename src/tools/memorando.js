// src/tools/memorando.js
const base44 = require('../base44');

/**
 * Retorna hora atual no fuso de SP (HH:mm)
 */
function horaAtualSP() {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}

/**
 * Cria um memorando no sistema Cobertex
 */
async function criarMemorando({ titulo, conteudo, criador_id, cliente_id, instalacao_id, urgente, tags, anexos, tag_livro, tag_eduardo, tags_livro, tags_eduardo }) {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    .split('/').reverse().join('-');

  const payload = {
    titulo: titulo || 'Relato operacional',
    conteudo_transcrito: conteudo,
    data: hoje,
    hora_cadastro: horaAtualSP(),
    criador_id,
    urgente: urgente || false,
    status: 'pendente',
  };

  if (cliente_id) payload.cliente_id = cliente_id;
  if (instalacao_id) payload.instalacao_id = instalacao_id;
  if (tags && tags.length) payload.tags = tags;
  if (anexos && anexos.length) payload.anexos = anexos;
  if (tag_livro) payload.tag_livro = true;
  if (tag_eduardo) payload.tag_eduardo = true;
  if (tags_livro && tags_livro.length) payload.tags_livro = tags_livro;
  if (tags_eduardo && tags_eduardo.length) payload.tags_eduardo = tags_eduardo;

  return base44.create('Memorando', payload);
}

async function buscarMemorandos({ texto, data, cliente_id, status, limit = 100 }) {
  const query = {};
  if (cliente_id) query.cliente_id = cliente_id;
  if (status) query.status = status;

  const todos = await base44.list('Memorando', query, limit);
  let resultado = todos;

  if (data) {
    const dataFiltro = normalizarData(data);
    if (dataFiltro) {
      resultado = resultado.filter(m => m.data && m.data.startsWith(dataFiltro));
    }
  }

  if (texto) {
    const busca = texto.toLowerCase();
    resultado = resultado.filter(m => {
      const titulo = (m.titulo || '').toLowerCase();
      const conteudo = (m.conteudo_transcrito || '').toLowerCase();
      const tags = (m.tags || []).join(' ').toLowerCase();
      const tagsLivro = (m.tags_livro || []).join(' ').toLowerCase();
      const tagsEduardo = (m.tags_eduardo || []).join(' ').toLowerCase();
      return titulo.includes(busca) || conteudo.includes(busca) || tags.includes(busca) || tagsLivro.includes(busca) || tagsEduardo.includes(busca);
    });
  }

  resultado.sort((a, b) => {
    const da = `${a.data || ''} ${a.hora_cadastro || ''}`;
    const db = `${b.data || ''} ${b.hora_cadastro || ''}`;
    return db.localeCompare(da);
  });

  return resultado;
}

function normalizarData(data) {
  const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  if (!data) return null;
  const d = data.toLowerCase().trim();
  if (d === 'hoje' || d === 'today') return agoraSP.toISOString().split('T')[0];
  if (d === 'ontem' || d === 'yesterday') {
    const ontem = new Date(agoraSP);
    ontem.setDate(ontem.getDate() - 1);
    return ontem.toISOString().split('T')[0];
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dia, mes, ano] = d.split('/');
    return `${ano}-${mes}-${dia}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return null;
}

async function listarMemorandos({ cliente_id, status, limit = 20 } = {}) {
  const query = {};
  if (cliente_id) query.cliente_id = cliente_id;
  if (status) query.status = status;
  const resultado = await base44.list('Memorando', query, limit);
  return resultado.sort((a, b) => {
    const da = `${a.data || ''} ${a.hora_cadastro || ''}`;
    const db = `${b.data || ''} ${b.hora_cadastro || ''}`;
    return db.localeCompare(da);
  });
}

async function atualizarMemorando({ memorando_id, campos }) {
  return base44.update('Memorando', memorando_id, campos);
}

async function adicionarAnexos({ memorando_id, novos_anexos }) {
  const memorando = await base44.get('Memorando', memorando_id);
  const anexosAtuais = memorando.anexos || [];
  const todosAnexos = [...anexosAtuais, ...novos_anexos].filter(Boolean);
  return base44.update('Memorando', memorando_id, { anexos: todosAnexos });
}

async function excluirMemorando({ memorando_id }) {
  await base44.remove('Memorando', memorando_id);
  return { excluido: true, memorando_id };
}

async function concluirMemorando({ memorando_id }) {
  return base44.update('Memorando', memorando_id, { status: 'concluido' });
}

module.exports = {
  criarMemorando,
  buscarMemorandos,
  listarMemorandos,
  atualizarMemorando,
  adicionarAnexos,
  excluirMemorando,
  concluirMemorando,
};

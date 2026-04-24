// src/services/base44.js
const axios = require('axios');

const BASE_URL = process.env.BASE44_BASE_URL || 'https://app.base44.com';
const APP_ID   = process.env.BASE44_APP_ID;
const API_KEY  = process.env.BASE44_API_KEY;

const api = axios.create({
  baseURL: `${BASE_URL}/api/apps/${APP_ID}/entities`,
  headers: { 'api_key': API_KEY, 'Content-Type': 'application/json' }
});

// ─── HELPERS ───────────────────────────────────────────────────────────────

async function listEntity(entity, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null) params.append(k, v);
  });
  const url = params.toString() ? `/${entity}?${params}` : `/${entity}`;
  const { data } = await api.get(url);
  return data;
}
async function getEntity(entity, id) { const { data } = await api.get(`/${entity}/${id}`); return data; }
async function createEntity(entity, payload) { const { data } = await api.post(`/${entity}`, payload); return data; }
async function updateEntity(entity, id, payload) { const { data } = await api.put(`/${entity}/${id}`, payload); return data; }
async function deleteEntity(entity, id) {
  try { const { data } = await api.delete(`/${entity}/${id}`); return { ok: true, data }; }
  catch (err) { return { ok: false, erro: err.message }; }
}

// ─── SANITIZAÇÃO DE DATAS ─────────────────────────────────────────────────

function sanitizarData(val) {
  if (!val || val === '-' || val === 'null' || String(val).toLowerCase().includes('pix')) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const meses = {janeiro:1,fevereiro:2,março:3,abril:4,maio:5,junho:6,julho:7,agosto:8,setembro:9,outubro:10,novembro:11,dezembro:12};
  const m1 = String(val).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m1) { const ano = m1[3].length===2?'20'+m1[3]:m1[3]; return `${ano}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`; }
  const m2 = String(val).toLowerCase().match(/(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?/);
  if (m2 && meses[m2[2]]) { const ano=m2[3]||new Date().getFullYear(); return `${ano}-${String(meses[m2[2]]).padStart(2,'0')}-${m2[1].padStart(2,'0')}`; }
  return null;
}
function sanitizarNumero(val) {
  if (val===null||val===undefined||val==='-') return null;
  if (typeof val==='number') return val;
  const n = parseFloat(String(val).replace(/[R$\s]/g,'').replace(',','.'));
  return isNaN(n) ? null : n;
}

// ─── USUÁRIOS (identificação por WhatsApp) ────────────────────────────────

async function buscarUsuarioPorWhatsapp(numero) {
  try {
    const chave = `${numero}@whatsapp`;
    const result = await listEntity('User');
    const lista = result.entities || result || [];
    return lista.find(u => u.email === chave) || null;
  } catch { return null; }
}

async function criarUsuarioWhatsapp(numero, nome) {
  try {
    return await createEntity('User', {
      email: `${numero}@whatsapp`,
      full_name: nome,
      role: 'user'
    });
  } catch (err) {
    console.error('[User] Erro ao criar:', err.message);
    return null;
  }
}

async function atualizarNomeUsuario(id, nome) {
  try { return await updateEntity('User', id, { full_name: nome }); }
  catch { return null; }
}

// ─── BOLETOS ───────────────────────────────────────────────────────────────

async function listarBoletos(filtros = {}) { return listEntity('Boleto', filtros); }

async function criarBoleto(dados) {
  const payload = { status: 'Pendente' };
  if (dados.numero)          payload.numero = String(dados.numero);
  if (dados.empresa)         payload.empresa = String(dados.empresa);
  if (dados.cliente)         payload.cliente = String(dados.cliente);
  if (dados.assessor)        payload.assessor = String(dados.assessor);
  if (dados.romaneio)        payload.romaneio = String(dados.romaneio);
  if (dados.observacoes)     payload.observacoes = String(dados.observacoes).substring(0,500);
  if (dados.forma_pagamento && dados.forma_pagamento!=='-') payload.forma_pagamento = String(dados.forma_pagamento);
  if (dados.status)          payload.status = dados.status;

  const locaisValidos = ['Bom Retiro','Brás','Megapolo','Outro'];
  if (dados.local) {
    const l = dados.local.toLowerCase();
    if (l.includes('bom retiro')) payload.local = 'Bom Retiro';
    else if (l.includes('br')) payload.local = 'Brás';
    else if (l.includes('mega')) payload.local = 'Megapolo';
    else if (locaisValidos.includes(dados.local)) payload.local = dados.local;
    else payload.local = 'Outro';
  }

  const valor = sanitizarNumero(dados.valor_total);
  if (valor !== null) payload.valor_total = valor; else payload.valor_total = 0;

  const comissao = sanitizarNumero(dados.percentual_comissao);
  payload.percentual_comissao = comissao !== null ? comissao : 5;

  const dc = sanitizarData(dados.data_compra);
  if (dc) payload.data_compra = dc;
  const dv = sanitizarData(dados.data_vencimento);
  if (dv) payload.data_vencimento = dv;
  const dp = sanitizarData(dados.data_pagamento);
  if (dp) payload.data_pagamento = dp;
  if (dados.status==='Pago' && !dp) payload.data_pagamento = new Date().toISOString().split('T')[0];

  if (!payload.empresa) throw new Error('Campo empresa é obrigatório');
  console.log('[CriarBoleto]', JSON.stringify(payload));
  return createEntity('Boleto', payload);
}

async function atualizarBoleto(id, dados) { return updateEntity('Boleto', id, dados); }
async function marcarBoletoComoPago(id, data) {
  return updateEntity('Boleto', id, { status:'Pago', data_pagamento: data||new Date().toISOString().split('T')[0] });
}
async function boletosVencidos() {
  const todos = await listarBoletos({status:'Pendente'});
  const hoje = new Date();
  return (todos.entities||todos).filter(b => b.data_vencimento && new Date(b.data_vencimento)<hoje);
}
async function boletosProximosVencer(dias=3) {
  const todos = await listarBoletos({status:'Pendente'});
  const hoje = new Date();
  const limite = new Date(hoje.getTime()+dias*86400000);
  return (todos.entities||todos).filter(b => {
    if (!b.data_vencimento) return false;
    const v = new Date(b.data_vencimento);
    return v>=hoje && v<=limite;
  });
}

// ─── LOJAS ─────────────────────────────────────────────────────────────────
// Campos obrigatórios: nome, local (Bom Retiro|Brás|Outro), percentual_comissao_padrao

async function listarLojas(filtros={}) { return listEntity('Loja', filtros); }

async function criarLoja(dados) {
  if (!dados.nome) throw new Error('Nome da loja é obrigatório');
  if (!dados.percentual_comissao_padrao && dados.percentual_comissao_padrao !== 0) {
    throw new Error('Percentual de comissão é obrigatório para cadastrar loja');
  }

  const locaisValidos = ['Bom Retiro','Brás','Outro'];
  let local = dados.local || 'Outro';
  const l = local.toLowerCase();
  if (l.includes('bom retiro')) local = 'Bom Retiro';
  else if (l.includes('br') || l.includes('brás') || l.includes('bras')) local = 'Brás';
  else if (!locaisValidos.includes(local)) local = 'Outro';

  const payload = {
    nome: String(dados.nome),
    local,
    percentual_comissao_padrao: parseFloat(dados.percentual_comissao_padrao) || 5
  };
  if (dados.telefone)    payload.telefone = dados.telefone;
  if (dados.email)       payload.email = dados.email;
  if (dados.observacoes) payload.observacoes = dados.observacoes;

  console.log('[CriarLoja]', JSON.stringify(payload));
  return createEntity('Loja', payload);
}

async function atualizarLoja(id, dados) { return updateEntity('Loja', id, dados); }

// ─── CATÁLOGOS ─────────────────────────────────────────────────────────────

async function listarCatalogos(filtros={}) { return listEntity('Catalogo', filtros); }
async function criarCatalogo(dados) { return createEntity('Catalogo', {ativo:true,...dados}); }
async function atualizarCatalogo(id, dados) { return updateEntity('Catalogo', id, dados); }

// ─── DELETE ────────────────────────────────────────────────────────────────

async function deletarEntidade(entity, id) { return deleteEntity(entity, id); }
async function deletarBoleto(id)   { return deleteEntity('Boleto', id); }
async function deletarLoja(id)     { return deleteEntity('Loja', id); }
async function deletarCatalogo(id) { return deleteEntity('Catalogo', id); }

// ─── DASHBOARD ─────────────────────────────────────────────────────────────

async function resumoDashboard() {
  const [boletos, lojas, catalogos] = await Promise.all([listarBoletos(), listarLojas(), listarCatalogos()]);
  const lista = boletos.entities || boletos || [];
  const hoje = new Date();
  const pendentes = lista.filter(b=>b.status==='Pendente');
  const pagos     = lista.filter(b=>b.status==='Pago');
  const vencidos  = lista.filter(b=>b.status==='Pendente'&&b.data_vencimento&&new Date(b.data_vencimento)<hoje);
  const totalComissoes = pagos.reduce((a,b)=>a+((b.valor_total||0)*(b.percentual_comissao||0)/100),0);
  const totalPendente  = pendentes.reduce((a,b)=>a+(b.valor_total||0),0);
  return {
    boletos: { total:lista.length, pendentes:pendentes.length, pagos:pagos.length, vencidos:vencidos.length, total_pendente:totalPendente, total_comissoes_recebidas:totalComissoes },
    lojas: (lojas.entities||lojas||[]).length,
    catalogos: (catalogos.entities||catalogos||[]).length
  };
}

// ─── RELATÓRIOS ANALÍTICOS ────────────────────────────────────────────────

async function relatorioComissoesPorLoja() {
  const result = await listarBoletos();
  const lista = result.entities || result || [];
  const agrupado = {};
  lista.forEach(b => {
    const empresa = b.empresa || 'Sem empresa';
    if (!agrupado[empresa]) agrupado[empresa] = { total_boletos:0, valor_total:0, comissao_total:0, comissao_recebida:0, boletos_pagos:0, percentuais:[] };
    const g = agrupado[empresa];
    const comissao = (b.valor_total||0)*(b.percentual_comissao||0)/100;
    g.total_boletos++;
    g.valor_total += b.valor_total||0;
    g.comissao_total += comissao;
    g.percentuais.push(b.percentual_comissao||0);
    if (b.status==='Pago') { g.comissao_recebida += comissao; g.boletos_pagos++; }
  });
  // Calcula médias
  Object.keys(agrupado).forEach(k => {
    const g = agrupado[k];
    g.percentual_medio = g.percentuais.length ? (g.percentuais.reduce((a,b)=>a+b,0)/g.percentuais.length).toFixed(1) : 0;
    delete g.percentuais;
  });
  return agrupado;
}

async function analisarDados(pergunta) {
  const result = await listarBoletos();
  const lista = result.entities || result || [];
  const pagos = lista.filter(b=>b.status==='Pago');
  const pendentes = lista.filter(b=>b.status==='Pendente');
  const hoje = new Date();
  const vencidos = pendentes.filter(b=>b.data_vencimento&&new Date(b.data_vencimento)<hoje);

  // Médias de comissão
  const percentuais = lista.filter(b=>b.percentual_comissao).map(b=>b.percentual_comissao);
  const mediaComissao = percentuais.length ? (percentuais.reduce((a,b)=>a+b,0)/percentuais.length).toFixed(1) : 0;

  // Por empresa
  const porEmpresa = {};
  lista.forEach(b => {
    const e = b.empresa||'Sem empresa';
    if (!porEmpresa[e]) porEmpresa[e] = {boletos:0,valor:0,comissao:0,pago:0};
    porEmpresa[e].boletos++;
    porEmpresa[e].valor += b.valor_total||0;
    porEmpresa[e].comissao += (b.valor_total||0)*(b.percentual_comissao||0)/100;
    if (b.status==='Pago') porEmpresa[e].pago += (b.valor_total||0)*(b.percentual_comissao||0)/100;
  });

  // Top lojas por comissão
  const topLojas = Object.entries(porEmpresa)
    .sort((a,b)=>b[1].comissao-a[1].comissao)
    .slice(0,5);

  return {
    total: lista.length,
    mediaComissao,
    totalComissaoRecebida: pagos.reduce((a,b)=>a+(b.valor_total||0)*(b.percentual_comissao||0)/100,0),
    totalComissaoPendente: pendentes.reduce((a,b)=>a+(b.valor_total||0)*(b.percentual_comissao||0)/100,0),
    valorTotalVendas: lista.reduce((a,b)=>a+(b.valor_total||0),0),
    vencidos: vencidos.length,
    topLojas,
    porEmpresa
  };
}


// ─── CUSTOS ────────────────────────────────────────────────────────────────
// Campos: descricao*, categoria*, valor*, data, forma_pagamento, status, observacoes

const CATEGORIAS_CUSTO = ['Logística', 'Administrativo', 'Marketing', 'Pessoal', 'Outros'];
const FORMAS_PAG_CUSTO = ['PIX', 'Dinheiro', 'Cartão', 'Boleto'];

function mapearCategoria(texto) {
  if (!texto) return 'Outros';
  const t = texto.toLowerCase();
  if (t.includes('motoboy') || t.includes('frete') || t.includes('entrega') || t.includes('transporte') || t.includes('logist')) return 'Logística';
  if (t.includes('admin') || t.includes('aluguel') || t.includes('escritório') || t.includes('escritorio') || t.includes('conta') || t.includes('taxa')) return 'Administrativo';
  if (t.includes('market') || t.includes('publicidade') || t.includes('anuncio') || t.includes('anúncio')) return 'Marketing';
  if (t.includes('pessoal') || t.includes('funcionário') || t.includes('funcionario') || t.includes('salário') || t.includes('salario')) return 'Pessoal';
  return 'Outros';
}

async function listarCustos(filtros = {}) {
  return listEntity('Custo', filtros);
}

async function criarCusto(dados) {
  if (!dados.descricao) throw new Error('Descrição do custo é obrigatória');
  if (!dados.valor)     throw new Error('Valor do custo é obrigatório');

  const categoria = CATEGORIAS_CUSTO.includes(dados.categoria)
    ? dados.categoria
    : mapearCategoria(dados.descricao);

  const payload = {
    descricao: String(dados.descricao),
    categoria,
    valor: sanitizarNumero(dados.valor) || 0,
    status: dados.status || 'Pago'
  };

  const data = sanitizarData(dados.data);
  if (data) payload.data = data;
  else payload.data = new Date().toISOString().split('T')[0];

  if (dados.forma_pagamento && FORMAS_PAG_CUSTO.includes(dados.forma_pagamento)) {
    payload.forma_pagamento = dados.forma_pagamento;
  } else if (dados.forma_pagamento) {
    const fp = dados.forma_pagamento.toLowerCase();
    if (fp.includes('pix'))      payload.forma_pagamento = 'PIX';
    else if (fp.includes('din')) payload.forma_pagamento = 'Dinheiro';
    else if (fp.includes('cart'))payload.forma_pagamento = 'Cartão';
    else if (fp.includes('bol')) payload.forma_pagamento = 'Boleto';
  }

  if (dados.observacoes) payload.observacoes = String(dados.observacoes).substring(0, 500);

  console.log('[CriarCusto]', JSON.stringify(payload));
  return createEntity('Custo', payload);
}

async function atualizarCusto(id, dados) { return updateEntity('Custo', id, dados); }
async function deletarCusto(id) { return deleteEntity('Custo', id); }

async function resumoCustos(mes = null) {
  const todos = await listarCustos();
  let lista = todos.entities || todos || [];

  if (mes) {
    lista = lista.filter(c => c.data && c.data.startsWith(mes));
  }

  const total = lista.reduce((a, c) => a + (c.valor || 0), 0);
  const pagos = lista.filter(c => c.status === 'Pago').reduce((a, c) => a + (c.valor || 0), 0);
  const pendentes = lista.filter(c => c.status === 'Pendente').reduce((a, c) => a + (c.valor || 0), 0);

  const porCategoria = {};
  lista.forEach(c => {
    const cat = c.categoria || 'Outros';
    if (!porCategoria[cat]) porCategoria[cat] = 0;
    porCategoria[cat] += c.valor || 0;
  });

  return { total, pagos, pendentes, porCategoria, quantidade: lista.length };
}

async function dre(mes = null) {
  // DRE simples: Receitas (comissões) - Despesas (custos) = Resultado
  const [boletos, custos] = await Promise.all([listarBoletos(), listarCustos()]);
  let listaBoletos = boletos.entities || boletos || [];
  let listaCustos  = custos.entities  || custos  || [];

  if (mes) {
    listaBoletos = listaBoletos.filter(b => b.data_pagamento && b.data_pagamento.startsWith(mes));
    listaCustos  = listaCustos.filter(c => c.data && c.data.startsWith(mes));
  }

  const receitaBruta    = listaBoletos.reduce((a, b) => a + (b.valor_total || 0), 0);
  const comissoesRecebidas = listaBoletos
    .filter(b => b.status === 'Pago')
    .reduce((a, b) => a + ((b.valor_total || 0) * (b.percentual_comissao || 0) / 100), 0);
  const comissoesPendentes = listaBoletos
    .filter(b => b.status !== 'Pago')
    .reduce((a, b) => a + ((b.valor_total || 0) * (b.percentual_comissao || 0) / 100), 0);
  const totalCustos     = listaCustos.reduce((a, c) => a + (c.valor || 0), 0);
  const resultado       = comissoesRecebidas - totalCustos;

  return { receitaBruta, comissoesRecebidas, comissoesPendentes, totalCustos, resultado, mes };
}

module.exports = {
  buscarUsuarioPorWhatsapp, criarUsuarioWhatsapp, atualizarNomeUsuario,
  listarBoletos, criarBoleto, atualizarBoleto, marcarBoletoComoPago, boletosVencidos, boletosProximosVencer,
  listarLojas, criarLoja, atualizarLoja,
  listarCatalogos, criarCatalogo, atualizarCatalogo,
  deletarBoleto, deletarLoja, deletarCatalogo, deletarEntidade,
  resumoDashboard, relatorioComissoesPorLoja, analisarDados,
  listarCustos, criarCusto, atualizarCusto, deletarCusto, resumoCustos, dre
};

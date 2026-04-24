// src/tools/relatorio.js — Geração de PDFs com PDFKit
const PDFDocument = require('pdfkit');

/**
 * Gera PDF em memória e retorna como Buffer
 * O envio pelo WhatsApp é feito pelo index.js via enviarDocumento()
 */
async function gerarPDFBuffer({ titulo, conteudo, dados }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const buffers = [];

      doc.on('data', chunk => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Cabeçalho
      doc.fontSize(20).font('Helvetica-Bold').text('COBERTEX', { align: 'center' });
      doc.fontSize(14).font('Helvetica').text(titulo, { align: 'center' });
      doc.fontSize(10).fillColor('#666').text(
        new Date().toLocaleDateString('pt-BR', {
          weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
          timeZone: 'America/Sao_Paulo',
        }),
        { align: 'center' }
      );
      doc.fillColor('#000').moveDown();
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();

      // Conteúdo texto livre
      if (conteudo) {
        doc.fontSize(11).font('Helvetica').text(conteudo);
        doc.moveDown();
      }

      // Dados estruturados (array de objetos)
      if (dados && Array.isArray(dados) && dados.length > 0) {
        dados.forEach((item, idx) => {
          if (doc.y > 700) doc.addPage();
          doc.fontSize(12).font('Helvetica-Bold')
            .text(`${idx + 1}. ${item.titulo || item.nome || item.numero_proposta || 'Item'}`);
          doc.fontSize(10).font('Helvetica');
          Object.entries(item).forEach(([key, value]) => {
            if (['titulo', 'nome', 'id', 'created_by'].includes(key) || !value || typeof value === 'object') return;
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            doc.text(`${label}: ${value}`);
          });
          doc.moveDown(0.5);
          doc.moveTo(50, doc.y).lineTo(545, doc.y).dash(3, { space: 3 }).stroke().undash();
          doc.moveDown(0.5);
        });
      }

      // Rodapé
      doc.fontSize(8).fillColor('#999')
        .text('Gerado pelo Assistente IA Cobertex — app.cobertex.com.br', 50, 780, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { gerarPDFBuffer };

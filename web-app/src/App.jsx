import React, { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { 
  UploadCloud, 
  FileText, 
  CheckCircle, 
  AlertTriangle, 
  Download, 
  Loader2, 
  Check, 
  X,
  FileCheck,
  RefreshCw
} from 'lucide-react';

// Configurando o worker do PDFJS localmente com o Vite (?url)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export default function App() {
  const [holeriteFile, setHoleriteFile] = useState(null);
  const [comprovanteFile, setComprovanteFile] = useState(null);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [results, setResults] = useState([]);
  const [zipBlob, setZipBlob] = useState(null);
  const [error, setError] = useState('');

  const holeriteInputRef = useRef(null);
  const comprovanteInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, type) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      if (type === 'holerite') {
        setHoleriteFile(file);
      } else {
        setComprovanteFile(file);
      }
      setError('');
    } else {
      setError('Por favor, envie apenas arquivos PDF.');
    }
  };

  const handleFileChange = (e, type) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      if (type === 'holerite') {
        setHoleriteFile(file);
      } else {
        setComprovanteFile(file);
      }
      setError('');
    }
  };

  const resetAll = () => {
    setHoleriteFile(null);
    setComprovanteFile(null);
    setResults([]);
    setProgress(0);
    setZipBlob(null);
    setStatusMessage('');
    setError('');
  };

  // Função para ler texto de uma página ordenando os fragmentos visualmente
  const getPageText = async (pdf, pageNumber) => {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    
    const items = textContent.items.map(item => ({
      str: item.str,
      x: item.transform[4],
      y: item.transform[5],
    }));

    // Agrupar itens por linha visual (tolerância de 5 pixels)
    const tolerance = 5;
    const lines = [];
    
    // Ordenar itens do topo para o rodapé (y decrescente)
    const sortedByY = [...items].sort((a, b) => b.y - a.y);
    
    for (const item of sortedByY) {
      let placed = false;
      for (const line of lines) {
        const avgY = line.reduce((sum, it) => sum + it.y, 0) / line.length;
        if (Math.abs(item.y - avgY) < tolerance) {
          line.push(item);
          placed = true;
          break;
        }
      }
      if (!placed) {
        lines.push([item]);
      }
    }
    
    // Ordenar cada linha da esquerda para a direita (x crescente) e juntar
    const sortedLines = lines.map(line => {
      return line.sort((a, b) => a.x - b.x).map(it => it.str).join(' ');
    });
    
    return sortedLines.join('\n');
  };

  const processPDFs = async () => {
    if (!holeriteFile || !comprovanteFile) {
      setError('Selecione ambos os arquivos PDF para continuar.');
      return;
    }

    setIsProcessing(true);
    setProgress(5);
    setStatusMessage('Lendo os arquivos PDF...');
    setResults([]);
    setZipBlob(null);
    setError('');

    try {
      // 1. Carregar PDFs na memória
      const holeriteBuffer = await holeriteFile.arrayBuffer();
      const comprovanteBuffer = await comprovanteFile.arrayBuffer();

      // Passa uma cópia (slice) do buffer para o PDFJS para evitar que ele seja desconectado (detached) pelo Worker
      const holeritePdfDoc = await pdfjsLib.getDocument({ data: holeriteBuffer.slice(0) }).promise;
      const comprovantePdfDoc = await pdfjsLib.getDocument({ data: comprovanteBuffer.slice(0) }).promise;

      setProgress(15);
      setStatusMessage('Buscando funcionários nos holerites...');

      // 2. Extrair nomes e páginas dos holerites
      const nomesPaginasHolerites = {};
      const totalPagesHolerites = holeritePdfDoc.numPages;

      for (let i = 1; i <= totalPagesHolerites; i++) {
        const text = await getPageText(holeritePdfDoc, i);
        // Regex idêntica ao Python, mas suportando caracteres com acento (À-ÿ)
        const regex = /Empregado\.\:\s*\d+\s*-\s*([\w\s\.\-À-ÿ]+?)\s+Admissão/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const nome = match[1].trim();
          if (!nomesPaginasHolerites[nome]) {
            nomesPaginasHolerites[nome] = [i - 1]; // 0-indexed para pdf-lib
          } else {
            nomesPaginasHolerites[nome].push(i - 1);
          }
        }
        setProgress(15 + Math.round((i / totalPagesHolerites) * 20));
      }

      const nomesEncontrados = Object.keys(nomesPaginasHolerites);
      if (nomesEncontrados.length === 0) {
        throw new Error('Nenhum nome de funcionário foi encontrado nos holerites. Verifique se o formato está correto.');
      }

      setProgress(40);
      setStatusMessage('Analisando comprovantes...');

      // 3. Extrair texto de todas as páginas dos comprovantes para correspondência
      const totalPagesComprovantes = comprovantePdfDoc.numPages;
      const comprovantesTextos = [];

      for (let i = 1; i <= totalPagesComprovantes; i++) {
        const text = await getPageText(comprovantePdfDoc, i);
        comprovantesTextos.push({ index: i - 1, text });
        setProgress(40 + Math.round((i / totalPagesComprovantes) * 20));
      }

      setProgress(60);
      setStatusMessage('Fazendo o matching e montando novos PDFs...');

      // 4. Carregar com pdf-lib para fatiar/mesclar
      const libHolerites = await PDFDocument.load(holeriteBuffer);
      const libComprovantes = await PDFDocument.load(comprovanteBuffer);
      
      const zip = new JSZip();
      const processResults = [];

      // Loop por cada funcionário para fatiar e empacotar
      const totalNomes = nomesEncontrados.length;
      for (let index = 0; index < totalNomes; index++) {
        const nome = nomesEncontrados[index];
        const paginasHolerite = nomesPaginasHolerites[nome];

        // Criar novo PDF
        const finalPdf = await PDFDocument.create();

        // Adicionar páginas do holerite
        const holeritePagesCopied = await finalPdf.copyPages(libHolerites, paginasHolerite);
        holeritePagesCopied.forEach(page => finalPdf.addPage(page));

        // Buscar correspondência no comprovante
        let comprovanteEncontrado = false;
        let indexComprovante = -1;

        for (const comp of comprovantesTextos) {
          if (comp.text.includes(nome)) {
            comprovanteEncontrado = true;
            indexComprovante = comp.index;
            break;
          }
        }

        if (comprovanteEncontrado) {
          const [comprovantePageCopied] = await finalPdf.copyPages(libComprovantes, [indexComprovante]);
          finalPdf.addPage(comprovantePageCopied);
        }

        // Salvar PDF final do funcionário
        const pdfBytes = await finalPdf.save();
        
        // Nome de arquivo limpo/seguro
        const nomeArquivoSeguro = nome.replace(/[^a-zA-Z0-9\s_]/g, '').trim();
        const nomeFinalArquivo = comprovanteEncontrado 
          ? `${nomeArquivoSeguro}.pdf` 
          : `_Sem_comprovante_${nomeArquivoSeguro}.pdf`;

        // Adicionar ao ZIP
        zip.file(nomeFinalArquivo, pdfBytes);

        processResults.push({
          nome,
          encontrado: comprovanteEncontrado,
          arquivo: nomeFinalArquivo
        });

        setProgress(60 + Math.round((index / totalNomes) * 30));
      }

      setStatusMessage('Empacotando resultados no arquivo ZIP...');
      const zipContent = await zip.generateAsync({ type: 'blob' });
      setZipBlob(zipContent);
      setResults(processResults);
      setProgress(100);
      setStatusMessage('Concluído com sucesso!');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Erro durante o processamento. Certifique-se de que os PDFs são válidos.');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadZip = () => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PDFs_Extraidos.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container">
      <header>
        <h1>Divisor de Holerites & Comprovantes</h1>
        <p className="subtitle">
          Processe e separe os holerites com seus comprovantes de forma rápida, local e 100% segura.
        </p>
      </header>

      {error && (
        <div className="alert alert-danger" id="error-alert">
          <AlertTriangle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Upload Zone */}
      <div className="card">
        <div className="drop-grid">
          {/* Holerites */}
          <div 
            className={`drop-zone ${holeriteFile ? 'completed' : ''}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'holerite')}
            onClick={() => holeriteInputRef.current?.click()}
          >
            <input 
              type="file" 
              accept=".pdf" 
              className="input-file-hidden" 
              ref={holeriteInputRef}
              onChange={(e) => handleFileChange(e, 'holerite')}
              disabled={isProcessing}
            />
            <UploadCloud className="drop-icon" size={48} />
            <h3>1. Arquivo de Holerites</h3>
            <p>Arraste o PDF de holerites aqui ou clique para selecionar</p>
            {holeriteFile && (
              <div className="file-info">
                <FileText size={16} />
                <span>{holeriteFile.name} ({(holeriteFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}
          </div>

          {/* Comprovantes */}
          <div 
            className={`drop-zone ${comprovanteFile ? 'completed' : ''}`}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'comprovante')}
            onClick={() => comprovanteInputRef.current?.click()}
          >
            <input 
              type="file" 
              accept=".pdf" 
              className="input-file-hidden" 
              ref={comprovanteInputRef}
              onChange={(e) => handleFileChange(e, 'comprovante')}
              disabled={isProcessing}
            />
            <UploadCloud className="drop-icon" size={48} />
            <h3>2. Arquivo de Comprovantes</h3>
            <p>Arraste o PDF de comprovantes aqui ou clique para selecionar</p>
            {comprovanteFile && (
              <div className="file-info">
                <FileText size={16} />
                <span>{comprovanteFile.name} ({(comprovanteFile.size / 1024).toFixed(1)} KB)</span>
              </div>
            )}
          </div>
        </div>

        <div className="actions">
          {(!results.length && !isProcessing) ? (
            <button 
              className="btn btn-primary" 
              onClick={processPDFs}
              disabled={!holeriteFile || !comprovanteFile}
              id="btn-processar"
            >
              Processar PDFs
            </button>
          ) : (
            <button 
              className="btn btn-primary" 
              style={{ background: 'var(--bg-tertiary)' }}
              onClick={resetAll}
              disabled={isProcessing}
              id="btn-resetar"
            >
              <RefreshCw size={18} />
              Limpar Tudo
            </button>
          )}

          {zipBlob && (
            <button 
              className="btn btn-success" 
              onClick={downloadZip}
              id="btn-download"
            >
              <Download size={18} />
              Baixar Todos (.ZIP)
            </button>
          )}
        </div>

        {/* Progress Bar */}
        {(isProcessing || progress > 0) && (
          <div style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              <span>{statusMessage}</span>
              <span>{progress}%</span>
            </div>
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}
      </div>

      {/* Results View */}
      {results.length > 0 && (
        <div className="card">
          <div className="status-header">
            <h2>Funcionários Processados ({results.length})</h2>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Total com comprovante: {results.filter(r => r.encontrado).length}
            </div>
          </div>

          <div className="status-grid">
            {results.map((result, i) => (
              <div className="status-row" key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {result.encontrado ? (
                    <FileCheck size={18} style={{ color: 'var(--color-success)' }} />
                  ) : (
                    <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />
                  )}
                  <span className="employee-name">{result.nome}</span>
                </div>
                <span className={`badge ${result.encontrado ? 'badge-success' : 'badge-warning'}`}>
                  {result.encontrado ? 'Comprovante OK' : 'Sem Comprovante'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer>
        <p>Desenvolvido localmente — Nenhum arquivo é transferido para servidores externos.</p>
      </footer>
    </div>
  );
}

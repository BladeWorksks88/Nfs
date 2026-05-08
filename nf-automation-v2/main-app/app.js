/**
 * NF Auto - Lógica Principal Consolidada
 */

// --- Estado Global ---
let nfs = []; 
let history = JSON.parse(localStorage.getItem('nf_auto_history') || '[]');
let currentFilter = 'Todas';
let searchTerm = '';
let directoryHandle = null;
let filePool = []; // Arquivos que foram arrastados mas não vinculados ainda

// Mock de dados iniciais
let mockData = [
    { id: 1, numero: '43436', cliente: 'Solar Tech Ltda', status: 'pendente', dataAgendamento: '', telefone: '', cidade: 'São Paulo' },
    { id: 2, numero: '43666', cliente: 'Energia Limpa S.A.', status: 'pendente', dataAgendamento: '23/04/2026', telefone: '', cidade: 'Curitiba' },
    { id: 3, numero: '43279', cliente: 'Fazenda Boa Vista', status: 'pendente', dataAgendamento: '', telefone: '', cidade: 'Ribeirão Preto' },
    { id: 4, numero: '44500', cliente: 'João Silva', status: 'pendente', dataAgendamento: '25/04/2026', telefone: '', cidade: 'São Paulo' }
];

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', () => {
    console.log('NF Auto: Inicializando...');
    
    // PDF.js Worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    
    // Carga Inicial
    applyDataAndGroup(mockData);
    renderHistoryTable();
    initEventListeners();
    
    logMsg('<span style="color: var(--primary)">Sistema pronto para uso.</span>');
});

// --- Listeners de Eventos ---
function initEventListeners() {
    const syncBtn = document.getElementById('sync-btn');
    const bulkBtn = document.getElementById('send-bulk-btn');
    const csvInput = document.getElementById('csv-input');
    const searchInput = document.getElementById('search-input');
    const filterChips = document.querySelectorAll('.filter-chip');
    const navItems = document.querySelectorAll('.nav-item');
    const sections = document.querySelectorAll('.view-section');

    // Navegação Lateral
    navItems.forEach(item => {
        item.onclick = (e) => {
            e.preventDefault();
            const view = item.getAttribute('data-view');
            navItems.forEach(i => i.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            item.classList.add('active');
            const target = document.getElementById(`view-${view}`);
            if (target) target.classList.add('active');
            if (view === 'messages') renderHistoryTable();
            if (view === 'settings') loadSettingsToForm();
            if (view === 'responses') {
                const dateInput = document.getElementById('filter-date');
                if (dateInput && !dateInput.value) {
                    dateInput.valueAsDate = new Date(); // set to today by default
                }
                fetchResponses();
            }
            safeCreateIcons();
        };
    });

    // Busca
    if (searchInput) {
        searchInput.oninput = (e) => {
            searchTerm = e.target.value.toLowerCase();
            renderTable();
        };
    }

    // Filtros
    filterChips.forEach(chip => {
        chip.onclick = () => {
            filterChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentFilter = chip.innerText;
            renderTable();
        };
    });

    // Sincronizar
    if (syncBtn) {
        syncBtn.onclick = () => {
            const settings = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
            if (!settings.sheetUrl) {
                if (confirm("Link do Sheets não configurado. Deseja carregar um arquivo CSV manual?")) {
                    if (csvInput) csvInput.click();
                }
            } else {
                syncFromSheets();
            }
        };
    }

    if (csvInput) {
        csvInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) syncFromSheets(file);
        };
    }

    // Enviar Tudo
    if (bulkBtn) {
        bulkBtn.onclick = async () => {
            const pending = nfs.filter(g => g.telefone && g.pdfStatus === 'ok' && g.status !== 'enviada');
            if (pending.length === 0) {
                alert("Nenhuma nota pronta para envio (com telefone e PDF).");
                return;
            }
            if (confirm(`Deseja enviar ${pending.length} mensagens agora?`)) {
                for (const group of pending) {
                    const msgInfo = getMessageForNFGroup(group.nfs);
                    sendWhatsApp(group, msgInfo);
                    await new Promise(r => setTimeout(r, 1500));
                }
            }
        };
    }

    // Fechar Modal
    document.querySelectorAll('.close-modal, #close-preview').forEach(btn => {
        btn.onclick = () => {
            const modal = document.getElementById('preview-modal');
            if (modal) modal.style.display = 'none';
        };
    });

    // Configurações
    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) {
        saveSettingsBtn.onclick = () => {
            const settings = {
                token:            document.getElementById('config-token')?.value.trim() || '',
                phoneId:          document.getElementById('config-phone-id')?.value.trim() || '',
                sheetUrl:         document.getElementById('config-sheet-url')?.value.trim() || '',
                formUrl:          document.getElementById('config-form-url')?.value.trim() || '',
                webhookUrl:       document.getElementById('config-webhook-url')?.value.trim() || '',
                whatsappVersion:  document.getElementById('config-whatsapp-version')?.value || 'web',
                autoScan:         document.getElementById('config-auto-scan')?.checked || false
            };
            localStorage.setItem('nf_auto_settings', JSON.stringify(settings));

            const apiConfigured = settings.token && settings.phoneId;
            logMsg(`✅ Configurações salvas! Modo de envio: <strong>${apiConfigured ? '🚀 API Meta (direto)' : '🌐 WhatsApp Web/Desktop'}</strong>`);
            alert(`Configurações salvas!\nModo: ${apiConfigured ? 'API Meta — envio direto' : 'WhatsApp Web/Desktop'}`);
            updateDashboard();
        };
    }

    // Garante que WhatsApp Web é o padrão salvo
    const saved = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
    if (!saved.whatsappVersion) {
        saved.whatsappVersion = 'web';
        localStorage.setItem('nf_auto_settings', JSON.stringify(saved));
    }

    // Drag and Drop (Dashboard)
    const dashboardView = document.getElementById('view-dashboard');
    if (dashboardView) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
            dashboardView.addEventListener(name, e => { e.preventDefault(); e.stopPropagation(); });
        });
        dashboardView.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
            if (files.length > 0) processFilesList(files);
        });
    }

    // Paste (CTRL+V)
    window.addEventListener('paste', (e) => {
        const files = Array.from(e.clipboardData.items)
            .filter(i => i.kind === 'file')
            .map(i => i.getAsFile())
            .filter(f => f && f.name.toLowerCase().endsWith('.pdf'));
        if (files.length > 0) processFilesList(files);
    });
    
    // Selecionar Pasta
    const folderBtn = document.getElementById('folder-btn');
    if (folderBtn) {
        folderBtn.onclick = () => selectNFDirectory();
    }

    // Auto-scan interval (5 min)
    setInterval(() => {
        const settings = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
        if (settings.autoScan && directoryHandle) {
            logMsg("Iniciando varredura automática...");
            scanDirectory();
        }
    }, 5 * 60 * 1000);

    // Eventos da tela de Respostas
    const refreshResponsesBtn = document.getElementById('refresh-responses-btn');
    if (refreshResponsesBtn) refreshResponsesBtn.onclick = fetchResponses;
    
    const filterDate = document.getElementById('filter-date');
    if (filterDate) filterDate.onchange = renderResponses;
}

// --- Processamento de Dados ---
function applyDataAndGroup(rawData) {
    if (!rawData || rawData.length === 0) return;
    const grouped = {};
    rawData.forEach(nf => {
        // Agora agrupa por TELEFONE + CIDADE.
        // Se não houver telefone, cada NF é um grupo único.
        const cityKey = (nf.cidade || '').toString().toLowerCase().trim();
        const key = nf.telefone 
            ? `${nf.telefone}_${cityKey}` 
            : `__no_phone_${nf.numero}_${Math.random().toString(36).substring(2, 6)}`;
            
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(nf);
    });

    nfs = Object.values(grouped).map((group, index) => {
        const first = group[0];
        const allPDF = group.every(n => n.fileObject);
        const somePDF = group.some(n => n.fileObject);
        return {
            id: index + 1,
            cliente: first.cliente,
            telefone: first.telefone || '',
            nfs: group,
            numero: group.map(n => n.numero).join(', '),
            status: group.every(n => n.status === 'enviada') ? 'enviada' : 'pendente',
            dataAgendamento: first.dataAgendamento || '',
            pdfStatus: allPDF ? 'ok' : (somePDF ? 'parcial' : 'missing')
        };
    });
    updateDashboard();
}

function syncFromSheets(source = null) {
    const settings = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
    let sheetUrl = (source instanceof File) ? null : (typeof source === 'string' ? source : settings.sheetUrl);
    const syncBtn = document.getElementById('sync-btn');
    const original = syncBtn.innerHTML;

    // Auto-correção de link do Google Sheets
    if (sheetUrl && sheetUrl.includes('docs.google.com/spreadsheets')) {
        if (sheetUrl.includes('/edit')) {
            sheetUrl = sheetUrl.split('/edit')[0] + '/export?format=csv';
            logMsg('<span style="color: var(--accent-orange)">Link convertido para exportação CSV.</span>');
        }
        sheetUrl += (sheetUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
    }

    if (!source && !sheetUrl) {
        alert("Configure o link do Sheets ou selecione um arquivo.");
        return;
    }

    syncBtn.innerHTML = '<i data-lucide="loader" class="spin"></i> Sincronizando...';
    safeCreateIcons();

    const options = {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
            const firstRowStr = JSON.stringify(res.data[0] || '');
            if (firstRowStr.includes('<!DOCTYPE') || firstRowStr.includes('<html')) {
                logMsg('<span style="color: #ef4444">Erro: O link aponta para uma página HTML, não para um arquivo de dados.</span>');
                logMsg('<span style="color: var(--accent-orange)">DICA: Vá em Arquivo > Compartilhar > Publicar na Web > Escolha "CSV" e use o link gerado lá!</span>');
                syncBtn.innerHTML = original;
                safeCreateIcons();
                return;
            }

            if (!res.data || res.data.length === 0 || (res.data.length === 1 && Object.keys(res.data[0]).length < 2)) {
                logMsg('<span style="color: #ef4444">Erro: Nenhum dado identificado. Verifique se a planilha está publicada como CSV.</span>');
                syncBtn.innerHTML = original;
                safeCreateIcons();
                return;
            }

            const data = res.data.map((row, index) => {
                const get = (keys) => {
                    const k = Object.keys(row).find(x => keys.some(key => x.toUpperCase().trim().includes(key)));
                    return k ? row[k] : '';
                };
                let rawNf = String(get(['NF', 'NUMERO', 'NOTA', 'NF-E', 'DOCUMENTO', 'NOTA FISCAL'])).trim();
                const cleanNf = rawNf.replace(/\D/g, '');
                if (!cleanNf) return null;
                return {
                    id: index + 1,
                    numero: rawNf,
                    cliente: get(['DESTINO', 'CLIENTE', 'NOME', 'RAZÃO SOCIAL', 'RECEBEDOR']) || 'Cliente Desconhecido',
                    telefone: get(['TELEFONE', 'TEL', 'WHATSAPP', 'FONE', 'WHATS', 'CELULAR']),
                    cidade: get(['CIDADE', 'MUNICIPIO', 'LOCALIDADE', 'CITY', 'DESTINO_CIDADE']),
                    status: 'pendente',
                    dataAgendamento: get(['AGENDAMENTO', 'DATA', 'ENTREGA', 'PREVISÃO', 'DATA DE ENTREGA'])
                };
            }).filter(x => x);

            const currentNfs = [];
            nfs.forEach(g => currentNfs.push(...g.nfs));
            const merged = data.map(newItem => {
                const ex = currentNfs.find(e => e.numero === newItem.numero);
                return ex ? { ...newItem, telefone: ex.telefone || newItem.telefone, fileObject: ex.fileObject } : newItem;
            });

            applyDataAndGroup(merged);
            syncBtn.innerHTML = original;
            safeCreateIcons();
            const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            document.getElementById('last-update').textContent = `Última atualização: ${now}`;
            logMsg(`Sucesso: ${data.length} notas carregadas.`);
        },
        error: (err) => {
            syncBtn.innerHTML = original;
            safeCreateIcons();
            logMsg(`<span style="color: #ef4444">Erro: ${err || 'CORS ou Conexão'}</span>`);
            if (confirm("Erro ao sincronizar. Deseja carregar o arquivo CSV manualmente?")) {
                document.getElementById('csv-input').click();
            }
        }
    };

    if (source instanceof File) Papa.parse(source, options);
    else Papa.parse(sheetUrl, { ...options, download: true });
}

// --- PDF & Automação ---
async function processFilesList(files) {
    let processed = 0;
    const currentNfs = [];
    nfs.forEach(g => currentNfs.push(...g.nfs));

    if (currentNfs.length === 0) {
        logMsg('<span style="color: #f59e0b">⚠️ Lista de NFs vazia. Sincronize a planilha antes de ler a pasta.</span>');
        return;
    }

    logMsg(`Iniciando análise de ${files.length} arquivos...`);

    const cleanStr = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

    for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.pdf')) continue;
        
        const baseName = file.name.replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "");
        const prefixPart = baseName.split(/[-_ ]/)[0];
        const cleanFileName = cleanStr(prefixPart);
        if (!cleanFileName) continue;

        const nfObj = currentNfs.find(n => {
            if (n.fileObject) return false;
            const cleanNfNum = cleanStr(n.numero);
            return cleanNfNum && (cleanFileName.includes(cleanNfNum) || cleanNfNum.includes(cleanFileName));
        });
            
        if (nfObj) {
            nfObj.fileObject = file;
            processed++;
            logMsg(`🔗 <strong>${file.name}</strong> vinculado à NF ${nfObj.numero}`);
            
            // Extração de telefone em background (RESTAURADO)
            extractTextFromPDF(file, true).then(text => {
                if (!text) return;
                const cleanText = text.replace(/\s+/g, ' ');
                let foundPhone = null;

                const labels = [/FONE\/FAX/i, /FONE/i, /TEL/i, /CELULAR/i, /WHATS/i];
                for (const label of labels) {
                    const match = cleanText.match(label);
                    if (match) {
                        const index = match.index;
                        const suffix = cleanText.substring(index, index + 80);
                        const phoneMatch = suffix.match(/(?:\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4})/);
                        if (phoneMatch) {
                            foundPhone = phoneMatch[0].replace(/\D/g, '');
                            break;
                        }
                    }
                }

                if (!foundPhone) {
                    const globalMatch = cleanText.match(/(?:\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4})/);
                    if (globalMatch) foundPhone = globalMatch[0].replace(/\D/g, '');
                }

                if (foundPhone && !nfObj.telefone) {
                    nfObj.telefone = foundPhone;
                    renderTable();
                }
            });
        } else {
            // Se não vinculou, guarda no "reservatório" (pool) para uso posterior
            if (!filePool.find(f => f.name === file.name)) {
                filePool.push(file);
            }
        }
    }
    
    // Tenta limpar o pool: se algum arquivo no pool agora combina com algo, vincula
    autoLinkFromPool();

    if (processed > 0) {
        applyDataAndGroup(currentNfs);
        renderTable();
        logMsg(`✅ Fim: <strong>${processed}</strong> notas vinculadas.`);
    } else {
        logMsg('<span style="color: #f59e0b">⚠️ Nenhum arquivo da pasta correspondeu às NFs pendentes.</span>');
    }
}

async function selectNFDirectory() {
    try {
        if (!window.showDirectoryPicker) {
            alert("Seu navegador não suporta seleção de pastas automática. Por favor, arraste os arquivos para a tela.");
            return;
        }
        directoryHandle = await window.showDirectoryPicker();
        logMsg("Pasta de NFs conectada com sucesso!");
        scanDirectory();
    } catch (err) {
        if (err.name !== 'AbortError') {
            logMsg(`<span style="color: #ef4444">Erro ao acessar pasta: ${err.message}</span>`);
        }
    }
}

async function scanDirectory() {
    if (!directoryHandle) return;
    try {
        const files = [];
        for await (const entry of directoryHandle.values()) {
            if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) {
                const file = await entry.getFile();
                files.push(file);
            }
        }
        if (files.length > 0) {
            processFilesList(files);
        }
    } catch (err) {
        logMsg(`<span style="color: #ef4444">Erro na varredura: ${err.message}</span>`);
    }
}

async function extractTextFromPDF(file, firstOnly = false) {
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    let text = '';
    const pages = firstOnly ? 1 : pdf.numPages;
    for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(it => it.str).join(' ') + ' ';
    }
    return text;
}

// --- UI Rendering ---
function updateDashboard() {
    const totalEl = document.getElementById('total-nfs');
    const pendingEl = document.getElementById('pending-nfs');
    const sentEl = document.getElementById('sent-nfs');
    const today = new Date().toLocaleDateString();
    const sentToday = history.filter(h => new Date(h.timestamp).toLocaleDateString() === today).length;

    const totalNfCount = nfs.reduce((sum, g) => sum + g.nfs.length, 0);
    if (totalEl) totalEl.textContent = totalNfCount;
    if (pendingEl) pendingEl.textContent = nfs.filter(g => !g.telefone || g.pdfStatus !== 'ok').length;
    if (sentEl) sentEl.textContent = sentToday;
    renderTable();
}

function renderTable() {
    const tableBody = document.getElementById('nf-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    const filtered = nfs.filter(g => {
        const msg = typeof getMessageForNFGroup === 'function' ? getMessageForNFGroup(g.nfs) : { type: 'Todas' };
        const matchesF = currentFilter === 'Todas' || msg.type === currentFilter;
        const matchesS = g.cliente.toLowerCase().includes(searchTerm) || g.numero.includes(searchTerm) || (g.telefone && g.telefone.includes(searchTerm));
        return matchesF && matchesS;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-dim);">Nenhuma nota encontrada. Sincronize ou Arraste PDFs!</td></tr>';
        return;
    }

    filtered.forEach(g => {
        const msg = typeof getMessageForNFGroup === 'function' ? getMessageForNFGroup(g.nfs) : { type: '---' };
        const tr = document.createElement('tr');
        const pdfCount = g.nfs.filter(n => n.fileObject).length;
        const pdfTotal = g.nfs.length;
        const badge = g.pdfStatus === 'ok'
            ? `status-previsao" style="cursor:pointer" title="Gerenciar PDFs" onclick="managePDFs(${g.id})">${pdfCount}/${pdfTotal} PDF 📂`
            : (g.pdfStatus === 'parcial'
                ? `status-roteirizacao" style="cursor:pointer" title="Gerenciar PDFs" onclick="managePDFs(${g.id})">${pdfCount}/${pdfTotal} PDF 📂`
                : 'status-missing">SEM PDF');
        
        tr.innerHTML = `
            <td>${g.numero}</td>
            <td>${g.cliente}</td>
            <td><span class="status-badge ${badge}</span></td>
            <td contenteditable="true" onblur="updatePhone(${g.id}, this.innerText)"><strong>${g.telefone || 'Digite...'}</strong></td>
            <td>${g.dataAgendamento || '--'}</td>
            <td><span class="status-badge status-${msg.type.toLowerCase()}">${msg.type}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="previewMessage(${g.id})" title="Visualizar"><i data-lucide="eye"></i></button>
                <button class="btn btn-secondary btn-sm" onclick="smartAttach(${g.id})" title="Anexar PDF (Auto/Manual)"><i data-lucide="paperclip"></i></button>
                <button class="btn btn-primary btn-sm" onclick="directSend(${g.id})" style="background: var(--accent-green);" title="Enviar"><i data-lucide="send"></i></button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
    safeCreateIcons();
}

function renderHistoryTable() {
    const body = document.getElementById('history-table-body');
    if (!body) return;
    body.innerHTML = history.slice(0, 50).map(e => `
        <tr>
            <td>${new Date(e.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
            <td><strong>${e.cliente}</strong><br><small>${e.telefone}</small></td>
            <td>#${e.nfs}</td>
            <td><span class="status-badge status-${e.tipo.toLowerCase()}">${e.tipo}</span></td>
            <td><span class="status-badge status-ok">Enviado</span></td>
        </tr>
    `).join('');
}

// --- Ações ---
async function previewMessage(id) {
    const g = nfs.find(x => x.id === id);
    if (!g) return;
    const msg = getMessageForNFGroup(g.nfs);
    const modal = document.getElementById('preview-modal');
    document.getElementById('message-preview-text').textContent = `PARA: ${g.telefone}\n---\n${msg.text}`;
    
    const visor = document.getElementById('pdf-viewer');
    const nfFile = g.nfs.find(n => n.fileObject);
    if (nfFile && visor) visor.src = URL.createObjectURL(nfFile.fileObject);
    
    document.getElementById('confirm-send').onclick = () => sendWhatsApp(g, msg);
    modal.style.display = 'flex';
}

function directSend(id) {
    const g = nfs.find(x => x.id === id);
    if (g && g.telefone) sendWhatsApp(g, getMessageForNFGroup(g.nfs));
}

function sendWhatsApp(group, msg) {
    if (!group.telefone) {
        alert('Nenhum telefone definido para esta nota!');
        return;
    }
    const settings = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
    const cleanPhone = '55' + group.telefone.replace(/\D/g, '');

    // --- Modo 1: API Meta (se token e phoneId configurados) ---
    if (settings.token && settings.phoneId) {
        sendViaAPI(group, msg, settings, cleanPhone);
        return;
    }

    // --- Modo 2: Fallback WhatsApp Web / Desktop ---
    const version = settings.whatsappVersion || 'web';
    const url = version === 'desktop'
        ? `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(msg.text)}`
        : `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg.text)}`;

    window.open(url, '_blank');
    logMsg(`📤 WhatsApp aberto para <strong>${group.cliente}</strong> — ${cleanPhone}`);
    logToHistory(group, msg);
    group.status = 'enviada';
    updateDashboard();

    // Lembra o usuário de anexar os PDFs manualmente
    const pdfs = group.nfs.filter(n => n.fileObject).map(n => n.fileObject.name);
    if (pdfs.length > 0) showPDFReminder(pdfs, group.cliente);

    const modal = document.getElementById('preview-modal');
    if (modal) modal.style.display = 'none';
}

async function sendViaAPI(group, msg, settings, cleanPhone) {
    const apiUrl = `https://graph.facebook.com/v19.0/${settings.phoneId}/messages`;

    logMsg(`🚀 Enviando via API para <strong>${group.cliente}</strong> (${cleanPhone})...`);

    try {
        // 1. Envia cada PDF como documento antes do texto
        const pdfs = group.nfs.filter(n => n.fileObject);
        for (const nfObj of pdfs) {
            const mediaId = await uploadMedia(nfObj.fileObject, settings);
            if (mediaId) {
                await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${settings.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: cleanPhone,
                        type: 'document',
                        document: { id: mediaId, filename: nfObj.fileObject.name }
                    })
                });
                logMsg(`📎 PDF <strong>${nfObj.fileObject.name}</strong> enviado como documento.`);
            } else {
                logMsg(`<span style="color:#f59e0b">⚠️ Não foi possível enviar o PDF ${nfObj.fileObject.name} via API.</span>`);
            }
        }

        // 2. Envia o texto da mensagem
        const res = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'text',
                text: { body: msg.text }
            })
        });

        const data = await res.json();

        if (res.ok) {
            logMsg(`✅ Mensagem enviada com sucesso via API para <strong>${group.cliente}</strong>`);
            logToHistory(group, msg);
            group.status = 'enviada';
            updateDashboard();
            const modal = document.getElementById('preview-modal');
            if (modal) modal.style.display = 'none';
        } else {
            const errMsg = data?.error?.message || JSON.stringify(data);
            logMsg(`<span style="color:#ef4444">❌ Erro API: ${errMsg}</span>`);
            if (confirm(`Erro ao enviar via API:\n${errMsg}\n\nDeseja abrir pelo WhatsApp Web?`)) {
                const url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg.text)}`;
                window.open(url, '_blank');
            }
        }
    } catch (err) {
        logMsg(`<span style="color:#ef4444">❌ Erro de rede: ${err.message}</span>`);
        if (confirm(`Erro de conexão com a API.\nDeseja abrir pelo WhatsApp Web?`)) {
            const url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msg.text)}`;
            window.open(url, '_blank');
        }
    }
}

async function uploadMedia(file, settings) {
    try {
        const formData = new FormData();
        formData.append('messaging_product', 'whatsapp');
        formData.append('file', file, file.name);

        const res = await fetch(`https://graph.facebook.com/v19.0/${settings.phoneId}/media`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${settings.token}` },
            body: formData
        });
        const data = await res.json();
        return data.id || null;
    } catch {
        return null;
    }
}

function showPDFReminder(filenames, cliente) {
    // Remove aviso anterior
    document.getElementById('pdf-reminder-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'pdf-reminder-toast';
    toast.style.cssText = [
        'position:fixed', 'bottom:2rem', 'right:2rem', 'z-index:9998',
        'background:#1e293b', 'border:1px solid #f59e0b', 'border-radius:0.75rem',
        'padding:1.25rem 1.5rem', 'max-width:360px', 'box-shadow:0 10px 40px rgba(0,0,0,0.5)',
        'animation:slideIn 0.3s ease'
    ].join(';');

    toast.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
            <div>
                <div style="color:#f59e0b;font-weight:600;font-size:0.9rem;margin-bottom:0.5rem;">
                    ⚠️ Anexe o(s) PDF(s) manualmente!
                </div>
                <div style="color:#94a3b8;font-size:0.78rem;margin-bottom:0.5rem;">Para: <strong style="color:#e2e8f0;">${cliente}</strong></div>
                ${filenames.map(f => `<div style="color:#cbd5e1;font-size:0.78rem;background:rgba(255,255,255,0.05);padding:0.3rem 0.6rem;border-radius:0.3rem;margin-bottom:0.25rem;">&#128196; ${f}</div>`).join('')}
                <div style="color:#64748b;font-size:0.72rem;margin-top:0.5rem;">Arraste o arquivo para a janela do WhatsApp.</div>
            </div>
            <button onclick="document.getElementById('pdf-reminder-toast').remove()" style="background:none;border:none;color:#475569;cursor:pointer;font-size:1.2rem;line-height:1;flex-shrink:0;">&times;</button>
        </div>
    `;

    document.body.appendChild(toast);

    // Auto-remove após 12 segundos
    setTimeout(() => toast?.remove(), 12000);
}

function loadSettingsToForm() {
    const s = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('config-token',            s.token || '');
    set('config-phone-id',         s.phoneId || '');
    set('config-sheet-url',        s.sheetUrl || '');
    set('config-form-url',         s.formUrl || '');
    set('config-webhook-url',      s.webhookUrl || '');
    set('config-whatsapp-version', s.whatsappVersion || 'web');
    const autoScan = document.getElementById('config-auto-scan');
    if (autoScan) autoScan.checked = s.autoScan || false;
}

function logToHistory(g, m) {
    history.unshift({ timestamp: new Date().toISOString(), cliente: g.cliente, telefone: g.telefone, nfs: g.numero, tipo: m.type });
    localStorage.setItem('nf_auto_history', JSON.stringify(history));
}

async function smartAttach(id) {
    const g = nfs.find(x => x.id === id);
    if (!g) return;

    // 1. Tenta buscar no "Reservatório" (arquivos que já foram arrastados mas não vinculados)
    const cleanStr = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
    const cleanNfNum = cleanStr(g.numero);

    const poolIndex = filePool.findIndex(file => {
        const baseName = file.name.replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "");
        const prefixPart = baseName.split(/[-_ ]/)[0];
        const cleanFileName = cleanStr(prefixPart);
        return cleanFileName.includes(cleanNfNum) || cleanNfNum.includes(cleanFileName);
    });

    if (poolIndex !== -1) {
        const file = filePool.splice(poolIndex, 1)[0];
        g.nfs.forEach(n => { if (!n.fileObject) n.fileObject = file; });
        logMsg(`✅ NF ${g.numero} vinculada automaticamente do reservatório!`);
        applyDataAndGroup(nfs.flatMap(group => group.nfs));
        renderTable();
        return;
    }

    // 2. Se tiver pasta selecionada, tenta nela
    if (directoryHandle) {
        logMsg(`🔍 Buscando na pasta para NF ${g.numero}...`);
        await scanDirectory();
        const updatedG = nfs.find(x => x.id === id);
        if (updatedG.pdfStatus !== 'missing') return;
    }
    
    // 3. Fallback: Seleção manual
    logMsg(`Escolha o arquivo manualmente para a NF ${g.numero}`);
    attachManualPDF(id);
}

function autoLinkFromPool() {
    if (filePool.length === 0) return;
    const currentNfs = [];
    nfs.forEach(g => currentNfs.push(...g.nfs));
    const cleanStr = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

    let linkedCount = 0;
    for (let i = filePool.length - 1; i >= 0; i--) {
        const file = filePool[i];
        const baseName = file.name.replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "");
        const prefixPart = baseName.split(/[-_ ]/)[0];
        const cleanFileName = cleanStr(prefixPart);

        const nfObj = currentNfs.find(n => !n.fileObject && (cleanFileName.includes(cleanStr(n.numero)) || cleanStr(n.numero).includes(cleanFileName)));
        if (nfObj) {
            nfObj.fileObject = file;
            filePool.splice(i, 1);
            linkedCount++;
        }
    }
    if (linkedCount > 0) {
        applyDataAndGroup(currentNfs);
        renderTable();
    }
}

async function attachManualPDF(id) {
    const g = nfs.find(x => x.id === id);
    if (!g) return;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';
    input.multiple = true; 

    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;

        let phoneFound = null;

        for (const file of files) {
            // 1. Tenta casar o arquivo com um NF pelo número no nome do arquivo
            const nameMatch = file.name.match(/(\d+)/);
            let targetNF = null;

            if (nameMatch) {
                const fileNum = nameMatch[1].replace(/^0+/, '');
                targetNF = g.nfs.find(n =>
                    n.numero.replace(/\D/g, '').replace(/^0+/, '') === fileNum
                );
            }

            // 2. Fallback: primeiro NF do grupo sem arquivo vinculado
            if (!targetNF) {
                targetNF = g.nfs.find(n => !n.fileObject) || g.nfs[0];
            }

            targetNF.fileObject = file;
            logMsg(file.name, `<span style="color: var(--accent-green)">Vinculado à NF ${targetNF.numero}</span>`);

            // Extrai telefone do primeiro PDF que tiver
            if (!phoneFound) {
                const text = await extractTextFromPDF(file, true);
                const cleanText = text.replace(/\s+/g, ' ');

                const labels = [/FONE\/FAX/i, /FONE/i, /TEL/i, /CELULAR/i, /WHATS/i];
                for (const label of labels) {
                    const match = cleanText.match(label);
                    if (match) {
                        const suffix = cleanText.substring(match.index, match.index + 80);
                        const phoneMatch = suffix.match(/(?:\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4})/);
                        if (phoneMatch) {
                            phoneFound = phoneMatch[0].replace(/\D/g, '');
                            break;
                        }
                    }
                }
                if (!phoneFound) {
                    const globalMatch = cleanText.match(/(?:\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4})/);
                    if (globalMatch) phoneFound = globalMatch[0].replace(/\D/g, '');
                }
            }
        }

        // Atualiza status do grupo
        const allPDF = g.nfs.every(n => n.fileObject);
        const somePDF = g.nfs.some(n => n.fileObject);
        g.pdfStatus = allPDF ? 'ok' : (somePDF ? 'parcial' : 'missing');

        if (phoneFound && !g.telefone) {
            g.telefone = phoneFound;
            g.nfs.forEach(n => n.telefone = phoneFound);
        }

        renderTable();
        logMsg(`📎 ${files.length} PDF(s) vinculado(s) ao grupo <strong>${g.numero}</strong>.`);
    };

    input.click();
}

function updatePhone(id, phone) {
    const g = nfs.find(x => x.id === id);
    if (g) { g.telefone = phone.replace(/\D/g, ''); g.nfs.forEach(n => n.telefone = g.telefone); }
}

function logMsg(msg, detail = '') {
    const el = document.getElementById('automation-log');
    if (el) {
        const div = document.createElement('div');
        div.innerHTML = `[${new Date().toLocaleTimeString()}] ${msg} ${detail}`;
        el.prepend(div);
    }
}

function safeCreateIcons() { if (typeof lucide !== 'undefined') lucide.createIcons(); }

// --- Gerenciamento de PDFs ---
function managePDFs(groupId) {
    const g = nfs.find(x => x.id === groupId);
    if (!g) return;

    // Remove modal anterior se existir
    document.getElementById('pdf-manager-modal')?.remove();

    const filesList = g.nfs.map((n, i) => {
        if (n.fileObject) {
            const size = (n.fileObject.size / 1024).toFixed(0);
            return `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:0.75rem; background:rgba(255,255,255,0.05); border-radius:0.5rem; margin-bottom:0.5rem; border:1px solid #333;">
                    <div>
                        <div style="font-size:0.85rem; color:#fff;">&#128196; ${n.fileObject.name}</div>
                        <div style="font-size:0.7rem; color:#666;">NF ${n.numero} &mdash; ${size} KB</div>
                    </div>
                    <button onclick="removePDF(${groupId}, ${i})" style="background:#ef444422; border:1px solid #ef4444; color:#ef4444; padding:0.4rem 0.8rem; border-radius:0.4rem; cursor:pointer; font-size:0.8rem; white-space:nowrap; margin-left:1rem;">&#10005; Remover</button>
                </div>
            `;
        } else {
            return `
                <div style="display:flex; align-items:center; padding:0.75rem; background:rgba(255,255,255,0.02); border-radius:0.5rem; margin-bottom:0.5rem; border:1px solid #222;">
                    <span style="font-size:0.85rem; color:#555;">NF ${n.numero} &mdash; sem PDF vinculado</span>
                </div>
            `;
        }
    }).join('');

    const hasFiles = g.nfs.some(n => n.fileObject);

    const modal = document.createElement('div');
    modal.id = 'pdf-manager-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div style="background:#1a1a1a; border:1px solid #333; border-radius:1rem; padding:2rem; min-width:420px; max-width:520px; box-shadow:0 25px 60px rgba(0,0,0,0.6);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                <div>
                    <h3 style="color:#fff; font-size:1.1rem; margin:0;">&#128193; Gerenciar PDFs</h3>
                    <p style="color:#666; font-size:0.75rem; margin:0.25rem 0 0;">${g.cliente} &mdash; NF(s) ${g.numero}</p>
                </div>
                <button onclick="document.getElementById('pdf-manager-modal').remove()" style="background:none;border:none;color:#666;font-size:1.5rem;cursor:pointer;line-height:1;">&times;</button>
            </div>
            <div>${filesList}</div>
            <div style="margin-top:1.25rem; display:flex; gap:0.75rem;">
                ${hasFiles ? `<button onclick="clearAllPDFs(${groupId})" style="flex:1;background:#ef444422;border:1px solid #ef4444;color:#ef4444;padding:0.75rem;border-radius:0.5rem;cursor:pointer;font-size:0.85rem;">&#128465; Remover Todos</button>` : ''}
                <button onclick="document.getElementById('pdf-manager-modal').remove()" style="flex:1;background:rgba(255,255,255,0.05);border:1px solid #444;color:#ccc;padding:0.75rem;border-radius:0.5rem;cursor:pointer;font-size:0.85rem;">Fechar</button>
            </div>
        </div>
    `;

    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
}

function removePDF(groupId, nfIndex) {
    const g = nfs.find(x => x.id === groupId);
    if (!g || !g.nfs[nfIndex]) return;

    const nfObj = g.nfs[nfIndex];
    const fname = nfObj.fileObject?.name || '';
    nfObj.fileObject = null;

    // Recalcula status do grupo
    const allPDF = g.nfs.every(n => n.fileObject);
    const somePDF = g.nfs.some(n => n.fileObject);
    g.pdfStatus = allPDF ? 'ok' : (somePDF ? 'parcial' : 'missing');

    logMsg(`🗑 PDF <strong>${fname}</strong> removido da NF ${nfObj.numero}.`);

    // Atualiza o modal e a tabela
    document.getElementById('pdf-manager-modal')?.remove();
    managePDFs(groupId);
    renderTable();
}

function clearAllPDFs(groupId) {
    const g = nfs.find(x => x.id === groupId);
    if (!g) return;
    if (!confirm(`Remover todos os PDFs do grupo "${g.cliente}"?`)) return;

    g.nfs.forEach(n => n.fileObject = null);
    g.pdfStatus = 'missing';

    logMsg(`🗑 Todos os PDFs removidos do grupo <strong>${g.numero}</strong>.`);
    document.getElementById('pdf-manager-modal')?.remove();
    renderTable();
}

window.managePDFs = managePDFs;
window.removePDF = removePDF;
window.clearAllPDFs = clearAllPDFs;

// --- Gestão de Respostas do Formulário ---
let responsesData = [];

async function fetchResponses() {
    const s = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
    if (!s.webhookUrl) {
        document.getElementById('responses-container').innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-dim); background: rgba(255,255,255,0.02); border-radius: 1rem;">
                <i data-lucide="alert-circle" style="width: 48px; height: 48px; color: #f59e0b; margin-bottom: 1rem; opacity: 0.8;"></i>
                <h3 style="color: #fff; margin-bottom: 0.5rem;">Webhook não configurado</h3>
                <p>Configure a URL do Webhook do Google Apps Script na aba Configurações para carregar as respostas do formulário.</p>
            </div>
        `;
        safeCreateIcons();
        return;
    }

    const btn = document.getElementById('refresh-responses-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Atualizando...';
    btn.disabled = true;
    safeCreateIcons();

    try {
        const response = await fetch(s.webhookUrl);
        if (!response.ok) throw new Error('Erro na rede: ' + response.statusText);
        
        const data = await response.json();
        
        // Asume-se que o backend retorne { status: 'success', data: [...] } ou diretamente o array
        responsesData = Array.isArray(data) ? data : (data.data || []);
        
        renderResponses();
    } catch (err) {
        console.error('Erro ao buscar respostas:', err);
        document.getElementById('responses-container').innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #ef4444; background: rgba(239, 68, 68, 0.05); border-radius: 1rem; border: 1px solid rgba(239, 68, 68, 0.2);">
                <i data-lucide="wifi-off" style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.8;"></i>
                <h3 style="margin-bottom: 0.5rem;">Erro de Conexão</h3>
                <p>Não foi possível carregar as respostas. Verifique a URL do Webhook e o CORS no Apps Script.</p>
                <small style="display:block; margin-top:0.5rem; opacity:0.7;">${err.message}</small>
            </div>
        `;
        safeCreateIcons();
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
        safeCreateIcons();
    }
}

function renderResponses() {
    const container = document.getElementById('responses-container');
    if (!container) return;
    
    const filterDateInput = document.getElementById('filter-date');
    const filterDate = filterDateInput ? filterDateInput.value : ''; // "YYYY-MM-DD"
    
    // Filtrar respostas pela data
    let filtered = responsesData;
    if (filterDate) {
        filtered = responsesData.filter(res => {
            if (!res.dataRegistro && !res.timestamp) return false;
            // O timestamp pode vir do Apps Script, por exemplo: "2026-05-06T10:00:00.000Z" ou "06/05/2026 10:00:00"
            const dateStr = String(res.dataRegistro || res.timestamp);
            if (dateStr.includes('/')) {
                // Formato DD/MM/YYYY
                const [datePart] = dateStr.split(' ');
                const [d, m, y] = datePart.split('/');
                const formatted = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                return formatted === filterDate;
            } else {
                // Formato ISO
                return dateStr.startsWith(filterDate);
            }
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 4rem; color: var(--text-dim);">
                <i data-lucide="inbox" style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.3;"></i>
                <p>Nenhuma resposta encontrada para esta data.</p>
            </div>
        `;
        safeCreateIcons();
        return;
    }

    container.innerHTML = filtered.map(res => {
        // Normaliza as chaves do objeto (dependendo de como o Apps Script retorna)
        const nf = res.nf || res.NF || 'Desconhecida';
        const cliente = res.cliente || res.Cliente || 'Não informado';
        const tipo = (res.type || res.Tipo || 'Roteirização').toUpperCase();
        
        const enderecoOk = res.endereco_correto || 'Não informado';
        const outroTel = res.telefone || 'Nenhum';
        const restricoes = res.restricoes || 'Nenhuma';
        const restricaoData = res.restricao_data || 'Nenhuma';
        
        const timeStr = (res.dataRegistro || res.timestamp || '').split(' ')[1] || (res.dataRegistro || res.timestamp);

        return `
            <div style="background: var(--card-bg); border-radius: 1rem; border: 1px solid var(--glass-border); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 10px 20px rgba(0,0,0,0.1);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <span style="display: inline-block; padding: 0.2rem 0.6rem; border-radius: 0.3rem; font-size: 0.7rem; font-weight: 600; background: ${tipo === 'PREVISÃO' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; color: ${tipo === 'PREVISÃO' ? '#60a5fa' : '#34d399'}; margin-bottom: 0.5rem; border: 1px solid ${tipo === 'PREVISÃO' ? '#3b82f6' : '#10b981'};">
                            ${tipo}
                        </span>
                        <h4 style="color: #fff; margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
                            <i data-lucide="user" style="width: 16px; height: 16px; color: var(--text-dim);"></i> ${cliente}
                        </h4>
                        <div style="color: var(--text-dim); font-size: 0.85rem; margin-top: 0.25rem;">NF: <strong>${nf}</strong></div>
                    </div>
                    <div style="color: var(--text-dim); font-size: 0.75rem; display: flex; align-items: center; gap: 0.25rem;">
                        <i data-lucide="clock" style="width: 12px; height: 12px;"></i> ${timeStr}
                    </div>
                </div>

                <div style="background: rgba(0,0,0,0.2); border-radius: 0.5rem; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
                    <div>
                        <div style="font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Endereço Correto?</div>
                        <div style="color: ${enderecoOk.toLowerCase() === 'sim' ? '#34d399' : '#f87171'}; font-weight: 500; font-size: 0.9rem;">${enderecoOk}</div>
                    </div>
                    ${tipo !== 'PREVISÃO' ? `
                    <div>
                        <div style="font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Outro Telefone</div>
                        <div style="color: #e2e8f0; font-size: 0.9rem;">${outroTel}</div>
                    </div>
                    ` : ''}
                    <div>
                        <div style="font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Restrições de Entrega</div>
                        <div style="color: #e2e8f0; font-size: 0.9rem; line-height: 1.4;">${restricoes}</div>
                    </div>
                    ${tipo !== 'PREVISÃO' ? `
                    <div>
                        <div style="font-size: 0.75rem; color: var(--text-dim); margin-bottom: 0.2rem;">Restrições de Data</div>
                        <div style="color: #e2e8f0; font-size: 0.9rem;">${restricaoData}</div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    safeCreateIcons();
}

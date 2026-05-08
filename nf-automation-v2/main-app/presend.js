// Lógica para a tela de Pré-envio Rápido

document.addEventListener('DOMContentLoaded', () => {
    const uploadZone = document.getElementById('presend-upload-zone');
    const fileInput = document.getElementById('presend-file');
    const dataCard = document.getElementById('presend-data-card');
    
    const nfInput = document.getElementById('presend-nf-num');
    const phoneInput = document.getElementById('presend-phone');
    const clientInput = document.getElementById('presend-client');
    const typeSelect = document.getElementById('presend-type');
    const submitBtn = document.getElementById('presend-submit-btn');

    let currentPdfFile = null;

    if (!uploadZone) return;

    // Drag and drop events
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        uploadZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        uploadZone.addEventListener(eventName, () => uploadZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        uploadZone.addEventListener(eventName, () => uploadZone.classList.remove('dragover'), false);
    });

    uploadZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        handleFiles(files);
    });

    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', function() {
        handleFiles(this.files);
    });

    function handleFiles(files) {
        const file = Array.from(files).find(f => f.name.toLowerCase().endsWith('.pdf'));
        if (file) {
            try {
                currentPdfFile = file;
                uploadZone.querySelector('h3').textContent = file.name;
                
                // Remove existing icon and create a new one to avoid Lucide issues
                const existingIcon = uploadZone.querySelector('.upload-zone-icon');
                if (existingIcon) existingIcon.remove();
                
                const newIcon = document.createElement('i');
                newIcon.setAttribute('data-lucide', 'file-check');
                newIcon.className = 'upload-zone-icon';
                newIcon.style.color = 'var(--success)';
                uploadZone.insertBefore(newIcon, uploadZone.firstChild);
                lucide.createIcons();
                
                dataCard.style.opacity = '1';
                dataCard.style.pointerEvents = 'auto';

                // Extrair número da NF pelo nome do arquivo (pegando apenas o número antes do hífen/série)
                const baseName = file.name.replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "");
                const prefixPart = baseName.split(/[-_ ]/)[0]; // Pega a primeira parte antes do hífen, underline ou espaço
                const cleanStr = String(prefixPart).replace(/\D/g, '').replace(/^0+/, '');
                if (cleanStr) {
                    nfInput.value = cleanStr;
                } else {
                    nfInput.value = "Não identificado";
                }

                phoneInput.value = 'Extraindo...';

                // Tentar extrair telefone lendo o PDF
                if (typeof extractTextFromPDF === 'function') {
                    extractTextFromPDF(file, true).then(text => {
                        if (!text) {
                            phoneInput.value = '';
                            return;
                        }
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

                        if (foundPhone) {
                            phoneInput.value = foundPhone;
                        } else {
                            phoneInput.value = '';
                        }
                    }).catch(err => {
                        console.error('Erro na extração de texto:', err);
                        phoneInput.value = '';
                    });
                } else {
                    phoneInput.value = '';
                }
            } catch (err) {
                console.error("Erro no handleFiles:", err);
            }
        }
    }

    submitBtn.addEventListener('click', async () => {
        if (!currentPdfFile) {
            alert('Por favor, anexe uma NF em PDF.');
            return;
        }
        if (!phoneInput.value || phoneInput.value === 'Extraindo...') {
            alert('Por favor, informe o telefone/WhatsApp de destino.');
            return;
        }
        if (!nfInput.value) {
            alert('Por favor, informe o número da NF.');
            return;
        }

        const originalBtnHTML = submitBtn.innerHTML;
        submitBtn.innerHTML = '<i data-lucide="loader" class="spin"></i> Gerando link do PDF e enviando...';
        submitBtn.disabled = true;
        
        try {
            // Re-render the loader icon specifically
            const loaderIcon = submitBtn.querySelector('i');
            if (loaderIcon) lucide.createIcons({ name: 'loader', icons: { loaderIcon } }); // This is safe, but typically just calling lucide.createIcons() works.
        } catch(e) {}
        lucide.createIcons();

        try {
            // 1. Converter PDF para Base64
            const base64 = await toBase64(currentPdfFile);
            const pureBase64 = base64.split(',')[1];
            
            // 2. Enviar para o Google Apps Script para salvar no Drive
            const settings = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
            const webhookUrl = settings.webhookUrl || document.getElementById('config-webhook-url').value;
            let pdfDriveUrl = '';

            if (webhookUrl) {
                const response = await fetch(webhookUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify({
                        action: 'upload_pdf',
                        filename: currentPdfFile.name,
                        base64: pureBase64
                    })
                });
                const result = await response.json();
                if (result.success) {
                    pdfDriveUrl = result.url || result.viewUrl; // Link de visualização/download
                } else {
                    console.error('Erro ao subir PDF:', result.message);
                }
            } else {
                console.warn('Webhook URL não configurada. O PDF não será anexado ao formulário online.');
            }

            // 3. Gerar URL do Formulário
            const formBaseUrl = settings.formUrl || 'https://seu-site.com/form.html';
            let finalFormUrl = `${formBaseUrl}?nf=${encodeURIComponent(nfInput.value)}&type=${typeSelect.value}&cliente=${encodeURIComponent(clientInput.value || 'Cliente')}`;
            if (pdfDriveUrl) {
                finalFormUrl += `&pdfUrl=${encodeURIComponent(pdfDriveUrl)}`;
            }

            // 4. Gerar Texto da Mensagem
            let msgText = '';
            const verb = 'está';
            
            if (typeSelect.value === 'roteirizacao') {
                msgText = `Roteirização
Olá, a NF ${nfInput.value} ${verb} com o time de roteirização.

Para seguirmos com a programação da entrega, por favor, confirme as informações e veja a Nota Fiscal acessando o link abaixo:

${finalFormUrl}

Após o preenchimento, o pedido será enviado para programação da rota e retornaremos com a previsão de entrega.`;
            } else {
                msgText = `Previsão de entrega
Olá, tudo bem?

A NF ${nfInput.value} ${verb} com entrega programada.

Para confirmar que podemos realizar a entrega, por favor, verifique as informações e veja a Nota Fiscal acessando o link abaixo:

${finalFormUrl}

Lembramos que a descarga dos materiais é por conta do cliente para Kits Fotovoltaicos acima de 30 KWP, e por nossa conta para Kits até 30 KW.`;
            }

            // 5. Enviar para WhatsApp
            const cleanPhone = '55' + phoneInput.value.replace(/\D/g, '');
            
            if (settings.token && settings.phoneId) {
                // Envia via API
                const apiUrl = `https://graph.facebook.com/v19.0/${settings.phoneId}/messages`;
                await fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${settings.token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: cleanPhone,
                        type: 'text',
                        text: { body: msgText }
                    })
                });
                alert('Mensagem enviada com sucesso via API!');
            } else {
                // Envia via Web/Desktop
                const version = settings.whatsappVersion || 'web';
                const url = version === 'desktop'
                    ? `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(msgText)}`
                    : `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(msgText)}`;
                window.open(url, '_blank');
            }

            // Limpar formulário após envio
            uploadZone.querySelector('h3').textContent = 'Arraste o PDF da NF aqui';
            
            const existingIcon = uploadZone.querySelector('.upload-zone-icon');
            if (existingIcon) existingIcon.remove();
            const newIcon = document.createElement('i');
            newIcon.setAttribute('data-lucide', 'upload-cloud');
            newIcon.className = 'upload-zone-icon';
            newIcon.style.color = 'var(--primary)';
            uploadZone.insertBefore(newIcon, uploadZone.firstChild);
            
            lucide.createIcons();
            
            currentPdfFile = null;
            dataCard.style.opacity = '0.5';
            dataCard.style.pointerEvents = 'none';
            nfInput.value = '';
            phoneInput.value = '';
            clientInput.value = '';

        } catch (error) {
            console.error(error);
            alert('Erro ao processar: ' + error.message);
        } finally {
            submitBtn.innerHTML = originalBtnHTML;
            submitBtn.disabled = false;
            lucide.createIcons();
        }
    });

    const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
    });
});

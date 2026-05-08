/**
 * Lógica para geração de mensagens do WhatsApp
 */

const SCRIPTS = {
    ROTEIRIZACAO: (nfs, cliente, formUrl) => {
        const nfList = nfs.join(', ');
        const plural = nfs.length > 1 ? 's' : '';
        const verb = nfs.length > 1 ? 'estão' : 'já está';
        
        const link = `${formUrl}?nf=${encodeURIComponent(nfList)}&type=roteirizacao&cliente=${encodeURIComponent(cliente)}`;

        return `Roteirização
Olá, a${plural} NF${plural} ${nfList} ${verb} com o time de roteirização.

Para seguirmos com a programação da entrega, por favor, confirme as informações acessando o link abaixo:

${link}

Após o preenchimento, o pedido será enviado para programação da rota e retornaremos com a previsão de entrega.`;
    },

    PREVISAO: (nfs, data, cliente, formUrl) => {
        const nfList = nfs.join(', ');
        const plural = nfs.length > 1 ? 's' : '';
        const verb = nfs.length > 1 ? 'estão' : 'está';
        
        const link = `${formUrl}?nf=${encodeURIComponent(nfList)}&type=previsao&cliente=${encodeURIComponent(cliente)}`;

        return `Previsão de entrega
Olá, tudo bem?

NF${plural}: ${nfList} ${verb} com a entrega prevista até o dia ${data} 

Para confirmar que podemos realizar a entrega, por favor, verifique as informações acessando o link abaixo:

${link}

Lembramos que a descarga dos materiais é por conta do cliente para Kits Fotovoltaicos acima de 30 KWP, e por nossa conta para Kits até 30 KW.`;
    }
};

function getMessageForNFGroup(nfsData) {
    const first = nfsData[0];
    const nfNumbers = nfsData.map(n => n.numero);
    
    // Obter configuração da URL do formulário
    let formUrl = '';
    if (typeof localStorage !== 'undefined') {
        const settings = JSON.parse(localStorage.getItem('nf_auto_settings') || '{}');
        formUrl = settings.formUrl || 'https://seu-site.com/form.html';
    } else {
        formUrl = 'https://seu-site.com/form.html';
    }
    
    // Se alguma nota no grupo não tiver data, o grupo todo é Roteirização (ou conforme regra de negócio)
    const needsScheduling = nfsData.some(n => !n.dataAgendamento || n.dataAgendamento === '');
    
    if (needsScheduling) {
        return {
            type: 'Roteirização',
            text: SCRIPTS.ROTEIRIZACAO(nfNumbers, first.cliente, formUrl),
            needsAttachment: true,
            nfs: nfNumbers,
            phone: first.telefone
        };
    } else {
        return {
            type: 'Previsão',
            text: SCRIPTS.PREVISAO(nfNumbers, first.dataAgendamento, first.cliente, formUrl),
            needsAttachment: false,
            nfs: nfNumbers,
            phone: first.telefone
        };
    }
}

// Export for use in app.js
if (typeof module !== 'undefined') {
    module.exports = { getMessageForNFGroup };
}

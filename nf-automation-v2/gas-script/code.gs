// Google Apps Script para o Formulario de Entrega
// Funcionalidade 1: Salvar PDF no Google Drive e retornar URL
// Funcionalidade 2: Salvar Respostas do Formulario no Google Sheets

const FOLDER_ID = 'SEU_ID_DA_PASTA_NO_DRIVE'; // Configurar o ID da pasta para salvar PDFs
const SHEET_ID = 'SEU_ID_DA_PLANILHA'; // Configurar o ID da planilha para as respostas

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // Ação: Fazer upload de PDF
    if (data.action === 'upload_pdf') {
      const folder = DriveApp.getFolderById(FOLDER_ID);
      const blob = Utilities.newBlob(Utilities.base64Decode(data.base64), 'application/pdf', data.filename);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        url: file.getDownloadUrl(),
        viewUrl: file.getUrl()
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Ação: Salvar formulário
    if (data.action === 'submit_form') {
      const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
      // O Form envia: nf, type, cliente, endereco_correto, telefone, restricoes, restricao_data, timestamp
      sheet.appendRow([
        data.timestamp,
        data.nf,
        data.cliente,
        data.type, // 'roteirizacao' ou 'previsao'
        data.endereco_correto || '',
        data.telefone || '',
        data.restricoes || '',
        data.restricao_data || ''
      ]);
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        message: 'Respostas salvas com sucesso'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: 'Ação não reconhecida'
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  // CORS Helper
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getActiveSheet();
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Cabeçalho está na linha 1. O código atual (doPost) salva nesta ordem:
    // timestamp, nf, cliente, type, endereco_correto, telefone, restricoes, restricao_data
    const keys = ["timestamp", "nf", "cliente", "type", "endereco_correto", "telefone", "restricoes", "restricao_data"];
    
    const results = [];
    for (let i = 1; i < data.length; i++) {
      let row = data[i];
      let obj = {};
      for (let j = 0; j < keys.length; j++) {
        obj[keys[j]] = row[j] || '';
      }
      results.push(obj);
    }
    
    // Inverter para mostrar os mais recentes primeiro
    results.reverse();
    
    return ContentService.createTextOutput(JSON.stringify(results)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      error: true,
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}


// Тестовые документы с выдуманными данными: docx, xlsx, pptx, PDF с текстом, PDF-скан без текста,
// PDF с паролем. node test/fixtures/make-files.mjs -> test/fixtures/files/
// Нужны python3 с python-docx, openpyxl и pypdf (только для пересборки, файлы лежат в git).
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'files');
mkdirSync(dir, { recursive: true });

const PY = String.raw`
import sys, zipfile, os
from docx import Document
from openpyxl import Workbook
d = sys.argv[1]

doc = Document()
doc.add_heading('Richiesta di bonifico', 1)
p = doc.add_paragraph('Il cliente ')
p.add_run('Mario Rossi').bold = True
p.add_run(' chiede un bonifico. Email mario.rossi@example.com, telefono +39 347 123 4567.')
t = doc.add_table(rows=2, cols=2)
t.cell(0, 0).text = 'IBAN'; t.cell(0, 1).text = 'IT60 X054 2811 1010 0000 0123 456'
t.cell(1, 0).text = 'Codice fiscale'; t.cell(1, 1).text = 'RSSMRA85T10A562S'
doc.sections[0].footer.paragraphs[0].text = 'Riservato: carta 4111 1111 1111 1111'
doc.save(os.path.join(d, 'richiesta.docx'))

wb = Workbook()
ws = wb.active; ws.title = 'Clienti'
ws.append(['Nome', 'Email', 'IBAN', 'Importo'])
ws.append(['Mario Rossi', 'mario.rossi@example.com', 'IT60 X054 2811 1010 0000 0123 456', 1250.5])
ws.append(['Giulia Bianchi', 'giulia.bianchi@example.com', None, 300])
ws2 = wb.create_sheet('Note')
ws2['B2'] = 'Chiamare il +39 347 123 4567'
wb.save(os.path.join(d, 'clienti.xlsx'))

slide = ('<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>'
  '<a:p><a:r><a:t>Cliente: Mario Rossi</a:t></a:r></a:p><a:p><a:r><a:t>Contatto mario.rossi@</a:t></a:r><a:r><a:t>example.com</a:t></a:r></a:p>'
  '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
with zipfile.ZipFile(os.path.join(d, 'presentazione.pptx'), 'w', zipfile.ZIP_DEFLATED) as z:
  z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  z.writestr('ppt/slides/slide1.xml', slide)
`;
execFileSync('python3', ['-c', PY, dir], { stdio: 'inherit' });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const html = (body) => `<!doctype html><meta charset="utf-8"><body style="font:14px Helvetica;margin:40px">${body}</body>`;
await page.setContent(html(`<h1>Estratto conto</h1><p>Intestatario: Mario Rossi, codice fiscale RSSMRA85T10A562S.</p>
<p>Email mario.rossi@example.com, IBAN IT60 X054 2811 1010 0000 0123 456.</p>
<table border="1" cellpadding="6"><tr><td>Carta</td><td>4111 1111 1111 1111</td></tr><tr><td>Saldo</td><td>1.250,50 EUR</td></tr></table>
<div style="page-break-before:always"><p>Pagina due: nessun dato personale.</p></div>`));
writeFileSync(path.join(dir, 'estratto.pdf'), await page.pdf({ format: 'A4' }));

await page.setContent(html('<p style="font-size:28px">Mario Rossi, mario.rossi@example.com</p>'));
const shot = await page.screenshot({ encoding: 'base64', clip: { x: 0, y: 0, width: 700, height: 120 } });
await page.setContent(html(`<img src="data:image/png;base64,${shot}" width="700">`));
writeFileSync(path.join(dir, 'scansione.pdf'), await page.pdf({ format: 'A4' }));
await browser.close();

// PDF с паролем (pypdf): такой файл не читается и не должен уйти молча.
execFileSync('python3', ['-c', `import sys
from pypdf import PdfReader, PdfWriter
w = PdfWriter(clone_from=PdfReader(sys.argv[1]))
w.encrypt('segreto', algorithm='AES-256')
w.write(sys.argv[2])`, path.join(dir, 'estratto.pdf'), path.join(dir, 'protetto.pdf')], { stdio: 'inherit' });
console.log('готово:', dir);

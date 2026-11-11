// Тестовые документы с выдуманными данными: docx, xlsx, pptx, PDF с текстом, PDF-скан без текста,
// PDF с паролем. node test/fixtures/make-files.mjs -> test/fixtures/files/
// Нужны python3 с python-docx, python-pptx, openpyxl и pypdf (только для пересборки, файлы лежат в git).
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

# Настоящая презентация: сайты (DeepSeek) отказываются разбирать пакет без связей и мастер-слайда.
# Адрес почты разбит на два фрагмента текста, как это делает PowerPoint после правки.
from pptx import Presentation
from pptx.util import Inches
prs = Presentation()
box = prs.slides.add_slide(prs.slide_layouts[6]).shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(2)).text_frame
box.paragraphs[0].add_run().text = 'Cliente: Mario Rossi'
p2 = box.add_paragraph()
p2.add_run().text = 'Contatto mario.rossi@'
p2.add_run().text = 'example.com'
prs.core_properties.author = 'Studio Demo'
prs.core_properties.last_modified_by = 'Studio Demo'
prs.save(os.path.join(d, 'presentazione.pptx'))
`;
execFileSync('python3', ['-c', PY, dir], { stdio: 'inherit' });

/* Данные только в скрытых местах: метаданные, автор и текст комментария, удалённый текст правки,
   поле со ссылкой, внешняя ссылка, надпись, колонтитул, вложенная книга, диаграмма, заметки
   к слайду, имя листа, число в ячейке, формула, подсказка проверки данных. Нужен python-pptx. */
const PY_HIDDEN = String.raw`
import sys, os, io, zipfile
from docx import Document
from docx.oxml import parse_xml
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.worksheet.datavalidation import DataValidation
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches
d = sys.argv[1]
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

doc = Document()
doc.core_properties.author = 'Mario Rossi'
doc.core_properties.last_modified_by = 'mario.rossi'
doc.core_properties.title = 'Pratica RSSMRA85T10A562S'
p = doc.add_paragraph('Contatto principale: mario.')
p.add_run('rossi@').bold = True
p.add_run('example.com')
p = doc.add_paragraph('IBAN corretto: ')
p._p.append(parse_xml('<w:del %s w:id="1" w:author="Giulia Bianchi" w:date="2026-10-01T10:00:00Z"><w:r><w:delText>IT60 X054 2811 1010 0000 0123 456</w:delText></w:r></w:del>' % W))
p = doc.add_paragraph()
p._p.append(parse_xml('<w:r %s><w:fldChar w:fldCharType="begin"/></w:r>' % W))
p._p.append(parse_xml('<w:r %s><w:instrText xml:space="preserve"> HYPERLINK "mailto:giulia.bianchi@example.com" </w:instrText></w:r>' % W))
p._p.append(parse_xml('<w:r %s><w:fldChar w:fldCharType="separate"/></w:r>' % W))
p._p.append(parse_xml('<w:r %s><w:t>scrivici</w:t></w:r>' % W))
p._p.append(parse_xml('<w:r %s><w:fldChar w:fldCharType="end"/></w:r>' % W))
rid = doc.part.relate_to('mailto:anna.verdi@example.com', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', is_external=True)
p = doc.add_paragraph('Assistenza: ')
p._p.append(parse_xml('<w:hyperlink %s xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="%s"><w:r><w:t>clicca qui</w:t></w:r></w:hyperlink>' % (W, rid)))
p = doc.add_paragraph('Vedi nota.')
doc.add_comment(p.runs, text='Verificare il codice RSSMRA85T10A562S', author='Giulia Bianchi', initials='GB')
doc.sections[0].header.paragraphs[0].text = 'Telefono +39 347 123 4567'
doc.save(os.path.join(d, 'nascosto.docx'))

src = zipfile.ZipFile(os.path.join(d, 'nascosto.docx'))
with zipfile.ZipFile(os.path.join(d, 'macro.docm'), 'w', zipfile.ZIP_DEFLATED) as z:
  for n in src.namelist():
    b = src.read(n)
    if n == '[Content_Types].xml':
      b = b.replace(b'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', b'application/vnd.ms-word.document.macroEnabled.main+xml')
      b = b.replace(b'</Types>', b'<Override PartName="/word/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>')
    if n == 'word/_rels/document.xml.rels':
      b = b.replace(b'</Relationships>', b'<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>')
    z.writestr(n, b)
  z.writestr('word/vbaProject.bin', b'Attribute VB_Name = "Modulo1"\nMsgBox "mario.rossi@example.com"')

wb = Workbook()
wb.properties.creator = 'Mario Rossi'
ws = wb.active; ws.title = 'CF RSSMRA85T10A562S'
ws['A1'] = 'Carta'; ws['B1'] = 4111111111111111
ws['A2'] = 'Contatto'; ws['B2'] = '="mario.rossi@example.com"'
ws['A3'] = 'Nota'; ws['A3'].comment = Comment('IBAN IT60 X054 2811 1010 0000 0123 456', 'Giulia Bianchi')
ws.oddHeader.center.text = 'giulia.bianchi@example.com'
dv = DataValidation(type='list', formula1='"si,no"', prompt='Chiedere a anna.verdi@example.com', promptTitle='Aiuto', showInputMessage=True)
ws.add_data_validation(dv); dv.add('C1')
wb.save(os.path.join(d, 'nascosto.xlsx'))

prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = 'Andamento'
cd = CategoryChartData()
cd.categories = ['mario.rossi@example.com', 'giulia.bianchi@example.com']
cd.add_series('Ordini', (3, 5))
s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(1), Inches(2), Inches(6), Inches(4), cd)
s.notes_slide.notes_text_frame.text = 'Codice fiscale del cliente RSSMRA85T10A562S'
prs.core_properties.author = 'Mario Rossi'
prs.save(os.path.join(d, 'nascosto.pptx'))
`;
execFileSync('python3', ['-c', PY_HIDDEN, dir], { stdio: 'inherit' });

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
const html = (body) => `<!doctype html><meta charset="utf-8"><body style="font:14px Helvetica;margin:40px">${body}</body>`;
await page.setContent(html(`<h1>Estratto conto</h1><p>Intestatario: Mario Rossi, codice fiscale RSSMRA85T10A562S.</p>
<p>Email mario.rossi@example.com, IBAN IT60 X054 2811 1010 0000 0123 456.</p>
<table border="1" cellpadding="6"><tr><td>Carta</td><td>4111 1111 1111 1111</td></tr><tr><td>Saldo</td><td>1.250,50 EUR</td></tr></table>
<div style="page-break-before:always"><p>Pagina due: nessun dato personale.</p></div>`));
writeFileSync(path.join(dir, 'estratto.pdf'), await page.pdf({ format: 'A4' }));

/* Длинный отчёт: имя только в самом конце, после первых 20 000 символов. Его находит только модель. */
const para = '<p>Il gruppo di lavoro ha verificato i moduli di gestione degli ordini, la reportistica mensile e i flussi di approvazione. Le prove di carico sono state ripetute su tre ambienti con risultati stabili e tempi di risposta nella norma.</p>';
await page.setContent(html('<h1>Relazione di avanzamento</h1>' + para.repeat(140) + '<p>Firmato: Luca Bianchi, responsabile del progetto.</p>'));
writeFileSync(path.join(dir, 'relazione-lunga.pdf'), await page.pdf({ format: 'A4' }));

await page.setContent(html('<p style="font-size:28px;color:#222;background:#fff">Mario Rossi, mario.rossi@example.com</p>'));
const shot = await page.screenshot({ encoding: 'base64', clip: { x: 0, y: 0, width: 700, height: 120 } });
await page.setContent(html(`<img src="data:image/png;base64,${shot}" width="700">`));
writeFileSync(path.join(dir, 'scansione.pdf'), await page.pdf({ format: 'A4' }));

/* Картинки для OCR: снимок экрана с данными, фото по-русски с GPS в EXIF, картинка без текста. */
await page.setViewport({ width: 820, height: 320 });
const card = (body) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff;color:#222">${body}</body>`;
await page.setContent(card(`<div style="font:18px Helvetica;line-height:1.6;padding:10px;border:1px solid #ccc;width:700px">
<b>Bonifico SEPA</b><br>Beneficiario: Mario Rossi<br>IBAN IT60 X054 2811 1010 0000 0123 456<br>
Email mario.rossi@example.com, telefono +39 333 123 4567<br>Codice fiscale RSSMRA85T10A562S<br>Importo 1.250,50 EUR</div>`));
writeFileSync(path.join(dir, 'bonifico.png'), await page.screenshot({ clip: { x: 0, y: 0, width: 800, height: 300 } }));
await page.setContent(card(`<div style="font:20px Helvetica;line-height:1.6;padding:10px;width:740px">Клиент: Мария Петрова<br>
Телефон +7 916 123-45-67<br>Почта maria.petrova@example.com<br>Встреча в четверг в 15:00</div>`));
writeFileSync(path.join(dir, 'chat-ru.raw.jpg'), await page.screenshot({ type: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 800, height: 220 } }));
await page.setContent(card('<div style="width:800px;height:300px;background:linear-gradient(135deg,#4a90d9,#f5c26b)"></div>'));
writeFileSync(path.join(dir, 'paesaggio.png'), await page.screenshot({ clip: { x: 0, y: 0, width: 400, height: 200 } }));
await browser.close();

/* EXIF с автором и координатами GPS (Pillow): после очистки их быть не должно. Документ Word,
   где данные есть только на вставленной картинке. */
execFileSync('python3', ['-c', String.raw`
import os, sys
from PIL import Image
from docx import Document
from docx.shared import Cm
d = sys.argv[1]
raw = os.path.join(d, 'chat-ru.raw.jpg')
im = Image.open(raw)
exif = Image.Exif()
exif[0x013B] = 'Maria Petrova'
exif[0x8825] = {1: 'N', 2: (45.0, 28.0, 12.0), 3: 'E', 4: (9.0, 11.0, 30.0)}
im.save(os.path.join(d, 'chat-ru.jpg'), quality=92, exif=exif)
os.remove(raw)
doc = Document()
doc.add_paragraph('Allego la ricevuta del bonifico.')
doc.add_picture(os.path.join(d, 'bonifico.png'), width=Cm(15))
doc.core_properties.author = 'Velami'
doc.save(os.path.join(d, 'ricevuta.docx'))
`, dir], { stdio: 'inherit' });

/* PDF, где на страницах в тексте данных нет: они на вставленной картинке, в поле формы, в комментарии
   и его авторе, в ссылке и в свойствах документа. И PDF с чистым текстом и вложенным файлом. Нужен PyMuPDF. */
execFileSync('python3', ['-c', String.raw`
import os, sys, fitz
d = sys.argv[1]
doc = fitz.open()
page = doc.new_page()
page.insert_text((72, 90), 'Modulo di richiesta', fontsize=20)
page.insert_text((72, 130), 'In allegato la ricevuta del bonifico e i dati del richiedente.', fontsize=11)
page.insert_image(fitz.Rect(72, 160, 472, 310), filename=os.path.join(d, 'bonifico.png'))
page.insert_text((72, 350), 'Codice fiscale del richiedente:', fontsize=11)
w = fitz.Widget()
w.field_name = 'cf'; w.field_type = fitz.PDF_WIDGET_TYPE_TEXT; w.rect = fitz.Rect(240, 336, 420, 356)
w.field_value = 'RSSMRA85T10A562S'; w.text_fontsize = 11
page.add_widget(w)
note = page.add_text_annot((500, 90), 'Sentire anche giulia.bianchi@example.com')
note.set_info(title='Luca Verdi'); note.update()
page.insert_text((72, 392), 'Scrivici', fontsize=11)
page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(72, 380, 130, 396), 'uri': 'mailto:paolo.neri@example.com'})
doc.set_metadata({'title': 'Modulo', 'author': 'Mario Rossi'})
doc.save(os.path.join(d, 'modulo.pdf'), deflate=True)

doc = fitz.open()
page = doc.new_page()
page.insert_text((72, 90), 'Verbale della riunione del gruppo di lavoro', fontsize=14)
page.insert_text((72, 120), 'Il materiale completo si trova nei file incorporati in questo documento.', fontsize=11)
doc.embfile_add('contatti.txt', b'Referente: mario.rossi@example.com, IBAN IT60 X054 2811 1010 0000 0123 456', filename='contatti.txt')
doc.save(os.path.join(d, 'allegato.pdf'), deflate=True)

doc = fitz.open()
page = doc.new_page()
page.insert_text((72, 90), 'Verbale della riunione del gruppo di lavoro', fontsize=14)
page.insert_text((72, 120), 'Il materiale completo si trova nei file incorporati in questo documento.', fontsize=11)
doc.embfile_add('dati.bin', bytes(range(256)) * 8, filename='dati.bin')
doc.save(os.path.join(d, 'allegato-binario.pdf'), deflate=True)
`, dir], { stdio: 'inherit' });

// PDF с паролем (pypdf): такой файл не читается и не должен уйти молча.
execFileSync('python3', ['-c', `import sys
from pypdf import PdfReader, PdfWriter
w = PdfWriter(clone_from=PdfReader(sys.argv[1]))
w.encrypt('segreto', algorithm='AES-256')
w.write(sys.argv[2])`, path.join(dir, 'estratto.pdf'), path.join(dir, 'protetto.pdf')], { stdio: 'inherit' });
console.log('готово:', dir);

// Рисует каждую страницу PDF через PDFKit, тем же движком, что у «Просмотра» на macOS.
// Chrome и «Просмотр» по-разному показывают прозрачность, поэтому проверять надо готовый PDF.
// swift quartz-pages.swift <файл.pdf> <папка>  ->  page-01.png, page-02.png, ...
import PDFKit
import AppKit

let args = CommandLine.arguments
guard args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("swift quartz-pages.swift <file.pdf> <dir>\n".data(using: .utf8)!)
  exit(1)
}
let scale: CGFloat = 96.0 / 72.0
for i in 0..<doc.pageCount {
  let page = doc.page(at: i)!
  let box = page.bounds(for: .mediaBox)
  let w = Int(box.width * scale), h = Int(box.height * scale)
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let ctx = NSGraphicsContext.current!.cgContext
  ctx.setFillColor(NSColor.white.cgColor)
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  NSGraphicsContext.restoreGraphicsState()
  let name = String(format: "page-%02d.png", i + 1)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]).appendingPathComponent(name))
}

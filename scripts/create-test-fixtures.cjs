// 用虚构内容生成测试 DOCX，公开仓库无需携带个人文档或 Word 作者元数据。
// 只补缺失夹具，保留开发者已经存在的本地测试文件。
const fs = require('node:fs/promises')
const path = require('node:path')
const JSZip = require('jszip')

async function create(file, title, fontSize) {
  try { await fs.access(file); return } catch {}
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="宋体"/><w:sz w:val="'+fontSize+'"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:rPr><w:sz w:val="'+fontSize+'"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>'+title+'</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>这是用于自动测试的虚构正文，保留段落与样式。</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>第二段正文用于验证文本内容没有变化。</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}
async function main() {
  const root = path.resolve(__dirname, '../__tests__')
  await create(path.join(root, 'fixtures/minimal.docx'), '示例标题', 24)
  await create(path.join(root, '测试文档1.docx'), '格式参考示例', 28)
  await create(path.join(root, '格式测试文档.docx'), '待排版示例', 22)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

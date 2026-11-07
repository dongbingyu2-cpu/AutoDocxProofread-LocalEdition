// 合成验收夹具：只用虚构文本，不读取用户文档。额外部件用于导出保真检查。
const JSZip = require('jszip')
const fs = require('node:fs/promises')
const SOURCE = '系统通过本地模型处理文档，并将校对建议显示在预览窗口中。这里有一个错务，需要进行修正。用户确认建议后可以导出文档，原始文件保持独立保存。'
async function makeFixture(file) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`)
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/test.png"/></Relationships>')
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:eastAsia="宋体"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>')
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>本地文档验收</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${SOURCE}</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>表格中的知识数据需要完整保留。</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>公式与脚注：</w:t></w:r><m:oMath><m:r><m:t>x=1</m:t></m:r></m:oMath><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`)
  zip.file('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>独立页眉</w:t></w:r></w:p></w:hdr>')
  zip.file('word/footer1.xml', '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>独立页脚</w:t></w:r></w:p></w:ftr>')
  zip.file('word/footnotes.xml', '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>脚注事实必须保留。</w:t></w:r></w:p></w:footnote></w:footnotes>')
  zip.file('word/media/test.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=', 'base64'))
  await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
}
async function verifyExport(original, exported) {
  const assert = require('node:assert/strict')
  const before = await JSZip.loadAsync(await fs.readFile(original)), after = await JSZip.loadAsync(await fs.readFile(exported))
  const untouched = ['word/styles.xml', 'word/header1.xml', 'word/footer1.xml', 'word/footnotes.xml', 'word/media/test.png']
  for (const name of untouched) assert.deepEqual(await after.file(name).async('nodebuffer'), await before.file(name).async('nodebuffer'), name)
  // docx-edit 可能调整关系条目的序列化顺序；比较完整属性集合，顺序不影响 OOXML 语义。
  const relationships = xml => (xml.match(/<Relationship\b[^>]+\/>/g) || []).map(entry => [...entry.matchAll(/([\w:]+)="([^"]*)"/g)].map(match => `${match[1]}=${match[2]}`).sort().join('|')).sort()
  assert.deepEqual(relationships(await after.file('word/_rels/document.xml.rels').async('string')), relationships(await before.file('word/_rels/document.xml.rels').async('string')))
  const xml = await after.file('word/document.xml').async('string')
  for (const token of ['w:tbl', 'm:oMath', 'footnoteReference', 'w:pgSz', 'w:pgMar', 'w:b']) assert.ok(xml.includes(token), token)
  assert.ok(xml.includes('错误'))
  return { unchangedParts: untouched.length, relationshipSetsPreserved: true, structuralChecks: 6 }
}
module.exports = { SOURCE, makeFixture, verifyExport }

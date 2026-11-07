// 正式包冷启动回归：使用合成文档及独立配置，不读取用户会话或调用模型。
const {launchPackaged}=require('./launchPackaged.cjs')
const {makeFixture}=require('./validationFixture.cjs')
const {expect}=require('@playwright/test')
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
let app
;(async()=>{const root=path.resolve('.validation',`session-restore-${Date.now()}`);await fs.mkdir(root,{recursive:true});const file=path.join(root,'session.docx');await makeFixture(file)
 const exe=process.env.LOCAL_EDITION_TEST_EXE||path.resolve('release/win-unpacked/AutoDocxProofread-LocalEdition.exe'),profile=path.join(root,'profile')
 try{
  app=await launchPackaged(exe,profile);let page=await app.firstWindow()
  await page.evaluate(file=>localStorage.setItem('fileInfo',JSON.stringify({filePath:file,fileName:'session.docx',proofModel:'',previewDarkAdapt:true,results:[{id:'saved-1',original:'错务',suggested:'错误',reason:'fixture',type:'Typo',applied:true}]})),file)
  await app.close();app=null
  app=await launchPackaged(exe,profile);page=await app.firstWindow();await page.locator('.file-name-tag').filter({hasText:'session.docx'}).waitFor()
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('fileInfo').results.length)).toBe(1)
  await expect.poll(()=>page.locator('.docx-wrapper').innerText()).toContain('错误')
  const result=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('fileInfo'));return {savedResults:s.results.length,applied:s.results[0].applied}})
  assert.equal(result.savedResults,1);assert.equal(result.applied,true)
  const report={kind:'Production EXE + synthetic DOCX + isolated profile; no model calls',coldStartResultsRetained:true,appliedPreviewRestored:true,persistedFlagsRetained:true}
  await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log('PASS cold-start results, applied preview, persisted flags')
 }finally{if(app)await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1})

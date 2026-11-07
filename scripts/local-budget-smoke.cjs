// 复现“长段落分片全部失败、0 产出”：真实正式 EXE/Word/IPC + 本机 Ollama Mock。
const {expect}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),JSZip=require('jszip');
const {launchPackaged}=require('./launchPackaged.cjs'),{makeFixture}=require('./validationFixture.cjs'),{acceptNativeDialog}=require('./acceptExport.cjs');
const root=path.resolve('.validation',`local-budget-${Date.now()}`),exe=process.env.LOCAL_EDITION_TEST_EXE||path.resolve('release/win-unpacked/AutoDocxProofread-LocalEdition.exe');
const report={kind:'Production EXE + real DOCX + local Mock Ollama',checks:[],rewriteRequests:0,reviewRequests:0,budgetViolations:0};let app,server,denyQuality=false,failTransport=false,forceResize=false,rejectNextReview=false;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS',name)};
(async()=>{
 await fs.mkdir(root,{recursive:true});const fixture=path.join(root,'long.docx'),small=path.join(root,'small.docx');await makeFixture(fixture);await makeFixture(small);
 const zip=await JSZip.loadAsync(await fs.readFile(fixture));const source='系统通过本地模型处理文档，用户确认建议后导出结果。'.repeat(250)+'这里有一个错务。';
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+source+'</w:t></w:r></w:p></w:body></w:document>');await fs.writeFile(fixture,await zip.generateAsync({type:'nodebuffer'}));
 server=http.createServer(async(req,res)=>{let raw='';for await(const p of req)raw+=p;const data=raw?JSON.parse(raw):{};const send=(value,code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value))};
 if(req.url==='/api/tags')return send({models:[{name:'budget-model'}]});if(req.url==='/api/show')return send({capabilities:['completion'],model_info:{'test.context_length':16384}});
 if(req.url!=='/api/chat')return send({},404);if(failTransport)return send({error:'fixture unavailable'},400);
 const system=data.messages[0].content,prompt=data.messages.at(-1).content;
 if(Buffer.byteLength(system+prompt,'utf8')+data.options.num_predict+256>data.options.num_ctx){report.budgetViolations++;return send({error:'budget violation'},400)}
 let content;
 if(system.includes('semanticPreserved')){report.reviewRequests++;content=JSON.stringify({semanticPreserved:!denyQuality&&!rejectNextReview,factsPreserved:true,termsPreserved:true,logicPreserved:true,expressionImproved:true});rejectNextReview=false}
 else if(prompt.includes('[需要改写的段落]')){report.rewriteRequests++;const target=prompt.split('[需要改写的段落]\n')[1].split('\n\n[下一段]')[0];if(forceResize&&Buffer.byteLength(target,'utf8')>512){report.resizeErrors=(report.resizeErrors||0)+1;return send({message:{content:'未完整输出'},done:true,done_reason:'length',prompt_eval_count:50,eval_count:4096})}content=target.replace('系统通过','该系统通过')}
 else content=JSON.stringify([{original:'错务',suggested:'错误',reason:'错别字',type:'Typo'}]);
 const value={message:{content},done:true,prompt_eval_count:50,eval_count:30};if(data.stream){res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.end(JSON.stringify(value)+'\n')}else send(value);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 app=await launchPackaged(exe,path.join(root,'profile'));const page=await app.firstWindow();
 await page.evaluate(async url=>{const api=window.electronAPI;await api.APISettings(url,'','budget-model','ollama');const s=await api.getLocalSettings();s.contextLength=16384;s.maxTokens=4096;await api.saveLocalSettings(s);await api.selectAPISetting(url,'','budget-model',1,null,'ollama')},url);
 const run=(mode,review=false)=>page.evaluate(({fixture,mode,review})=>window.electronAPI.processDocx(mode,fixture,undefined,undefined,null,1,null,`budget-${Date.now()}`,review),{fixture,mode,review});
 const reduced=await run('reduceAI');report.initial={suggestions:reduced.proofResult?.length,tokens:reduced.token_usage,failures:reduced.failedSegments?.map(x=>x.message),message:reduced.message};
 check('长段落降 AI 不再因上下文全部失败',!reduced.message&&!reduced.failedSegments?.length&&reduced.proofResult?.length===1);
 check('子片完整重组，默认不逐片追加语义复核请求',reduced.proofResult[0].original===source&&report.rewriteRequests>1&&report.reviewRequests===0);
 check('所有实际发送请求均包含系统/输出预算且未超限',report.budgetViolations===0);
 const polished=await run('polish');check('全文润色也按本地预算拆分',!polished.message&&!polished.failedSegments?.length&&polished.proofResult?.length>0);
 denyQuality=true;const rejected=await run('reduceAI',true);denyQuality=false;
 check('语义复核失败保留整段原文且不把已用 Token 记成 0',!rejected.proofResult?.length&&rejected.failedSegments?.length>0&&rejected.token_usage>0);
 forceResize=true;const recovered=await run('reduceAI');forceResize=false;
 check('输出达到上限时同模型缩小子片重试，不采用截断正文',report.resizeErrors>0&&!recovered.failedSegments?.length&&recovered.proofResult?.length===1&&recovered.token_usage>=report.resizeErrors*4146);
 rejectNextReview=true;const partial=await run('reduceAI',true);
 check('单个子片拒绝保留该子片，其余通过复核的修改仍有产出',partial.failedSegments?.length===1&&partial.proofResult?.length===1&&partial.token_usage>0);
 const output=path.join(root,'rewritten.docx');const save=acceptNativeDialog(app,output);
 const [saved]=await Promise.all([page.evaluate(({fixture,corrections})=>window.electronAPI.exportCorrectedDocx({originalFilePath:fixture,appliedCorrections:corrections}),{fixture,corrections:reduced.proofResult}),save]);
 const exported=await JSZip.loadAsync(await fs.readFile(output));check('整段重组建议实际写回 Word',saved.success&&saved.appliedCount===1&&(await exported.file('word/document.xml').async('string')).includes('该系统通过'));
 await page.reload();await page.getByTestId('document-model-select').click();await page.getByRole('option').filter({hasText:'budget-model'}).click();
 const open=acceptNativeDialog(app,small,'选择 DOCX 文件');await Promise.all([page.getByRole('button',{name:'选择文件',exact:true}).click(),open]);await page.locator('.file-name-tag').filter({hasText:'small.docx'}).waitFor();
 await page.locator('.mode-select').click();await page.getByRole('option',{name:'降低AI率',exact:true}).click();failTransport=true;
 await page.getByRole('button',{name:'开始校正',exact:true}).click();await expect(page.locator('.error-alert')).toContainText('Ollama HTTP 400');await expect(page.locator('.error-alert')).toBeVisible();await page.screenshot({path:path.join(root,'failure.png'),animations:'disabled'});report.errorDisplay=await page.locator('.error-alert .el-alert__title').evaluate(el=>({color:getComputedStyle(el).color,opacity:getComputedStyle(el.closest('.error-alert')).opacity}));
 check('全部失败时展示具体原因，禁止“处理成功/0 Token”假成功',await page.getByText(/处理成功/).count()===0&&await page.getByRole('button',{name:'导出结果',exact:true}).isDisabled());
})().catch(e=>{report.error=String(e.stack||e);console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close().catch(()=>{});if(server){server.closeAllConnections();server.close()}await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(root,'report.json'))});

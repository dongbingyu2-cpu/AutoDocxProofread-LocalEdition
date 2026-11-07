// 同机模拟云接口：对照原作者安装版与本地版，固定响应延迟、输入和模型，不使用真实密钥。
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict'),JSZip=require('jszip');
const {expect}=require('@playwright/test');
const {launchPackaged}=require('./launchPackaged.cjs'),{makeFixture}=require('./validationFixture.cjs'),{acceptNativeDialog}=require('./acceptExport.cjs');
const root=path.resolve('.validation',`cloud-speed-${Date.now()}`),report={kind:'Original EXE vs Local Edition, fixed-delay loopback cloud Mock',runs:[],checks:[]};let server,original,current,phase;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS',name)};
async function main(){
 await fs.mkdir(root,{recursive:true});const fixture=path.join(root,'cloud.docx');await makeFixture(fixture);const zip=await JSZip.loadAsync(await fs.readFile(fixture));
 const paragraphs=Array.from({length:21},(_,i)=>`系统通过第${i+1}个模块接收输入并处理资料，无论采用哪种方式，都可以查看不同任务的运行记录。原始资料保持独立保存，处理结果展示在界面上。`);
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>云端性能合成测试</w:t></w:r></w:p>'+paragraphs.map(p=>'<w:p><w:r><w:t>'+p+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');await fs.writeFile(fixture,await zip.generateAsync({type:'nodebuffer'}));
 server=http.createServer(async(req,res)=>{let raw='';for await(const p of req)raw+=p;const data=raw?JSON.parse(raw):{};if(req.url==='/api/tags'){res.end(JSON.stringify({models:[{name:'local-choice'}]}));return}if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return}
 const run=phase;run.active++;run.peak=Math.max(run.peak,run.active);const system=data.messages[0].content,prompt=data.messages.at(-1).content,review=system.includes('semanticPreserved');run[review?'reviewRequests':'rewriteRequests']++;
 let content;if(review)content=JSON.stringify({semanticPreserved:false,factsPreserved:true,termsPreserved:true,logicPreserved:true,expressionImproved:true});else{run.promptHashes.push(crypto.createHash('sha256').update(system+'\0'+prompt).digest('hex'));content=prompt.split('[需要改写的段落]\n')[1].split('\n\n[下一段]')[0].replace('系统通过','该系统通过');if(run.negation)content=content.replace('无论采用哪种方式','采用任何一种方式').replace('不同任务','各项任务');if(run.riskyNumbers)content=content.replace(/第\d+个模块/,'第999个模块')}
 await new Promise(resolve=>setTimeout(resolve,75));if(data.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content}}],usage:{total_tokens:10}})+'\n\ndata: [DONE]\n\n')}else{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content}}],usage:{total_tokens:10}}))}run.active--;
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
 const baselineExe=process.env.UPSTREAM_TEST_EXE||'D:/autodocxproofread/AutoDocxProofreading/AutoDocxProofreading.exe';
 original=await launchPackaged(baselineExe,path.join(root,'original'),false);const oldPage=await original.firstWindow();
 await oldPage.evaluate(async url=>{await window.electronAPI.selectAPISetting(url+'/v1','fixture-key-only','cloud-fixture',30,null,'openai_compatible',null,'disabled')},url);
 const run=async(page,label,parallel,negation=false,review=false)=>{phase={label,negation,active:0,peak:0,rewriteRequests:0,reviewRequests:0,promptHashes:[]};const started=Date.now();const result=await page.evaluate(({fixture,parallel,review})=>window.electronAPI.processDocx('reduceAI',fixture,undefined,undefined,null,parallel,null,'cloud-'+Date.now(),review),{fixture,parallel,review});const outcome={...phase,elapsedMs:Date.now()-started,suggestions:result.proofResult?.length||0,failed:result.failedSegments?.length||0,warnings:result.proofResult?.filter(p=>p.qualityWarnings?.length).length||0};delete outcome.active;outcome.promptHashes.sort();report.runs.push(outcome);console.log(JSON.stringify({...outcome,promptHashes:undefined}));return outcome};
 const base=await run(oldPage,'original',30);check('原作者路径每段一次生成且无强制语义复核',base.suggestions===21&&base.rewriteRequests===21&&base.reviewRequests===0);await original.close();original=null;
 current=await launchPackaged(process.env.LOCAL_EDITION_TEST_EXE||path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AutoDocxProofread-LocalEdition', 'AutoDocxProofread-LocalEdition.exe'),path.join(root,'current'));const page=await current.firstWindow();
 await page.evaluate(async url=>{const api=window.electronAPI;await api.APISettings(url,'','local-choice','ollama');await api.APISettings(url+'/v1','fixture-key-only','cloud-fixture','openai_compatible')},url);await page.reload();
 const choose=async name=>{await page.getByTestId('document-model-select').click();await page.getByRole('option').filter({hasText:name}).click()};
 await choose('local-choice');await choose('cloud-fixture');const parallel=(await page.evaluate(()=>window.electronAPI.getAPISettings())).parallel;report.selectedCloudParallel=parallel;console.log('CLOUD_PARALLEL',parallel);await page.evaluate(({url,parallel})=>window.electronAPI.selectAPISetting(url+'/v1','fixture-key-only','cloud-fixture',parallel,null,'openai_compatible',null,'disabled'),{url,parallel});
 const fast=await run(page,'current-default',parallel);const negative=await run(page,'current-equivalent-negation',parallel,true);
 await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
 check('切换本地到云端后恢复原版默认并发',parallel===30);
 check('默认云端保持原版一次请求/段且无额外复核',fast.rewriteRequests===21&&fast.reviewRequests===0&&fast.suggestions===21&&fast.failed===0);
 check('云端系统提示、前后文及段落拆分与原版完全一致',JSON.stringify(fast.promptHashes)===JSON.stringify(base.promptHashes));
 check('等义否定表达变化不导致全篇失败',negative.suggestions===21&&negative.failed===0&&negative.warnings===0);
 check('同延迟 Mock 云端请求保持并行',fast.peak>=10&&fast.elapsedMs<base.elapsedMs*3+250);
 const optional=await run(page,'current-opt-in-review',parallel,false,true);check('额外语义复核只在明确开启时调用，拒绝只标记风险供预览',optional.reviewRequests===21&&optional.suggestions===21&&optional.failed===0&&optional.warnings===21);
 check('文档页额外复核默认关闭',!await page.getByTestId('cloud-extra-review').locator('input').isChecked());
 phase={label:'cloud-ui',negation:false,riskyNumbers:true,active:0,peak:0,rewriteRequests:0,reviewRequests:0,promptHashes:[]};
 const open=acceptNativeDialog(current,fixture,'选择 DOCX 文件');await Promise.all([page.getByRole('button',{name:'选择文件',exact:true}).click(),open]);
 await page.locator('.file-name-tag').filter({hasText:'cloud.docx'}).waitFor();await page.locator('.mode-select').click();await page.getByRole('option',{name:'降低AI率',exact:true}).click();
 await page.getByRole('button',{name:'开始校正',exact:true}).click();await expect(page.getByRole('button',{name:'导出结果',exact:true})).toBeEnabled();
 if(!await page.getByTestId('quality-warning').first().isVisible())await page.locator('.el-collapse-item__header').first().click();await expect(page.getByTestId('quality-warning').first()).toBeVisible();
 check('质量风险在预览展示，21 段仍完成且没有失败告警',await page.locator('.el-collapse-item').count()===21&&await page.locator('.error-alert').count()===0&&phase.reviewRequests===0);
 await page.screenshot({path:path.join(root,'cloud-quality-preview.png'),animations:'disabled'});
 await page.locator('.apply-changes-btn').click();await page.locator('.el-dropdown-menu__item').filter({hasText:'应用全部修改'}).click();
 const output=path.join(root,'cloud-export.docx');const save=acceptNativeDialog(current,output);await Promise.all([page.getByRole('button',{name:'导出结果',exact:true}).click(),save]);
 const exported=await JSZip.loadAsync(await fs.readFile(output),{checkCRC32:true});check('云端改写实际走完预览、应用、导出按钮流程',(await exported.file('word/document.xml').async('string')).includes('该系统通过'));
 await page.locator('.sidebar-nav .sidebar-btn').nth(3).click();await page.getByTestId('local-edition-panel').waitFor();
 const cloudSlider=page.locator('.custom-slider input').first();await cloudSlider.fill('1');await cloudSlider.press('Enter');await cloudSlider.blur();
 await expect.poll(async()=>(await page.evaluate(()=>window.electronAPI.getAPISettings())).parallel).toBe(1);
 await page.locator('.sidebar-nav .sidebar-btn').first().click();await choose('local-choice');await choose('cloud-fixture');
 check('用户新设置的云端并发 1 在本地切换后得到保留',(await page.evaluate(()=>window.electronAPI.getAPISettings())).parallel===1);
 await current.close();current=null;current=await launchPackaged(process.env.LOCAL_EDITION_TEST_EXE||path.join(process.env.LOCALAPPDATA || '', 'Programs', 'AutoDocxProofread-LocalEdition', 'AutoDocxProofread-LocalEdition.exe'),path.join(root,'current'));
 const restarted=await current.firstWindow();await expect(restarted.getByTestId('document-model-select')).toContainText('cloud-fixture');
 await expect.poll(async()=>(await restarted.evaluate(()=>window.electronAPI.getAPISettings())).parallel).toBe(1);check('显式云端并发 1 重启后继续保留',true);

}
main().catch(e=>{report.error=String(e.stack||e);console.error(e);process.exitCode=1}).finally(async()=>{if(original)await original.close().catch(()=>{});if(current)await current.close().catch(()=>{});if(server){server.closeAllConnections();server.close()}await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log('REPORT',path.join(root,'report.json'))});

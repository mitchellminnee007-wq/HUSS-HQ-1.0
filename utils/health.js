const {monitorEventLoopDelay}=require('node:perf_hooks');
const samples=[],jobs=new Map(),initialized=new WeakSet();let loop=null;
function record(kind,ms=0,guildId=null,details=null){samples.push({kind,ms:Number(ms)||0,guildId,at:Date.now(),...(details?{details}:{})});while(samples.length>5000||samples[0]?.at<Date.now()-900000)samples.shift();}
function heartbeat(name,success=true){const old=jobs.get(name)||{};jobs.set(name,{...old,lastAttempt:Date.now(),...(success?{lastSuccess:Date.now()}:{lastFailure:Date.now()})});}
function percentile(values,p){if(!values.length)return null;values=[...values].sort((a,b)=>a-b);return Math.round(values[Math.min(values.length-1,Math.floor(values.length*p))]);}
function snapshot(guildId){const recent=samples.filter(s=>s.at>Date.now()-900000),own=recent.filter(s=>!s.guildId||s.guildId===guildId);return {windowMinutes:15,restErrors:recent.filter(s=>s.kind==='rest_error').length,throttledRequests:recent.filter(s=>s.kind==='rest_throttle').length,recentErrors:recent.filter(s=>s.kind==='rest_error'&&s.details).slice(-5).reverse().map(s=>({...s.details,at:s.at})),rateLimits:recent.filter(s=>s.kind==='rate_limit').length,interactionFailures:own.filter(s=>s.kind==='interaction_failure').length,responseP95:percentile(own.filter(s=>s.kind==='response').map(s=>s.ms),.95),notificationFailures:own.filter(s=>s.kind==='notification_failure').length,ttsErrors:own.filter(s=>s.kind==='tts_failure').length,ttsWaitP95:percentile(own.filter(s=>s.kind==='tts_wait').map(s=>s.ms),.95),ttsSynthesisP95:percentile(own.filter(s=>s.kind==='tts_synthesis').map(s=>s.ms),.95),loopP95:loop?Math.round(loop.percentile(95)/1e6):null,rssMiB:Math.round(process.memoryUsage().rss/1048576),jobs:Object.fromEntries(jobs)};}
function attach(i){let acknowledged=false;const start=Date.now();for(const method of ['reply','deferReply','update','deferUpdate','showModal','respond']){const original=i[method]?.bind(i);if(!original)continue;i[method]=async(...args)=>{try{const result=await original(...args);if(!acknowledged){acknowledged=true;record('response',Date.now()-start,i.guildId);}return result;}catch(e){record('interaction_failure',0,i.guildId);throw e;}};}}
function requestCategory(request) {
 const path=String(request?.route||request?.path||'');
 if (/^\/interactions\//.test(path)) return 'Interaction acknowledgement';
 if (/^\/webhooks\//.test(path)) return 'Webhook message';
 if (/^\/channels\/[^/]+\/messages/.test(path)) return 'Channel message';
 if (/^\/guilds\/[^/]+\/members/.test(path)) return 'Server member / role';
 if (/^\/applications\//.test(path)) return 'Application commands';
 if (/^\/channels\//.test(path)) return 'Channel';
 if (/^\/guilds\//.test(path)) return 'Server';
 return 'Other Discord request';
}
function observeResponse(request,response) {
 if (!(response.status>=400)) return;
 const details={status:Number(response.status),category:requestCategory(request)};
 record(response.status===429?'rest_throttle':'rest_error',0,null,details);
 // Do not consume the response body or retain URLs, tokens or request contents.
 console.warn(`[Discord health] ${new Date().toISOString()} HTTP ${details.status} • ${details.category}`);
}
function init(client){if(initialized.has(client))return;initialized.add(client);loop=monitorEventLoopDelay({resolution:20});loop.enable();setInterval(()=>loop.reset(),900000).unref();client.rest.on('response',observeResponse);client.rest.on('rateLimited',()=>record('rate_limit'));}
module.exports={record,heartbeat,snapshot,attach,init,percentile,requestCategory,observeResponse};

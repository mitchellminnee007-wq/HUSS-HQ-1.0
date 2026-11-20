// Interaction tokens stay in memory only. Private views expire before Discord's 15-minute limit.
const VIEW=Symbol('live logistics view'),views=new Map(),dirty=new Set();let client=null,timer=null,running=false;const failures=new Map();
function tagged(payload,view){return {...payload,[VIEW]:view};}
function render(guild,member,user,view){const i={guildId:member.guild.id,member,user};
 if(!require('./logistics-access').memberAccess(member))throw new Error('Your access to this browser has changed.');
 const maintenance=require('./maintenance').active(i.guildId,view.kind);if(maintenance)return {...require('./maintenance').notice(maintenance),embeds:[],components:[]};
 if(view.kind==='order'){const p=require('./order-panel');return view.id?p.detailPayload(guild,i,view.id):p.listPayload(guild,i,view.filter,view.page);}
 if(view.kind==='stockpile'){const p=require('./stockpile-panel');return view.id?p.detailPayload(guild,member,view.id,view.page,view.filter):p.listPayload(guild,member,view.page);}
 const p=require('./manifest-panel');return view.id?p.detail(guild,i,view.id):p.list(guild,i,view.page,view.filter);
}
function attach(i){
 if(!i.guildId)return;
 if(i.message?.id)views.delete(i.guildId+':'+i.message.id);
 for(const method of ['reply','update','editReply']){
  const original=i[method]?.bind(i);if(!original)continue;
  i[method]=async function(payload,...rest){const result=await original(payload,...rest);if(!payload?.[VIEW])return result;
   try{const msg=await i.fetchReply();if(!msg.flags.has(64))return result;const key=i.guildId+':'+msg.id;
    if(views.size>=200&&!views.has(key))views.delete(views.keys().next().value);
    views.set(key,{guildId:i.guildId,userId:i.user.id,user:i.user,view:payload[VIEW],expires:Math.min(i.createdTimestamp+14*60000,Date.now()+14*60000),edit:p=>i.webhook.editMessage(msg.id,p)});
   }catch(e){console.warn('[Live panels] Could not subscribe:',e.code||e.name);}return result;
  };
 }
}
async function flush(){if(running||!client)return;running=true;const ids=[...dirty];dirty.clear();
 try{for(const guildId of ids){const guild=client.guilds.cache.get(guildId);if(!guild)continue;let data;try{data=require('./logistics-store').read().guilds[guildId]||{stockpiles:{},orders:{},manifests:{}};}catch(e){console.error('[Live panels] Store read failed');continue;}
  for(const [key,v]of views){if(v.expires<=Date.now()){views.delete(key);continue;}if(v.guildId!==guildId)continue;
   try{const member=await guild.members.fetch({user:v.userId,force:true});if(views.get(key)!==v)continue;let payload;try{payload=render(data,member,v.user,v.view);}catch{payload={content:'This view is no longer accessible. Reopen the browser for your current access.',embeds:[],components:[],allowedMentions:{parse:[]}};}
    if(views.get(key)===v){await v.edit({...payload,content:payload.content||null});failures.set(guildId,0);}
   }catch(e){failures.set(guildId,(failures.get(guildId)||0)+1);if([10008,10015,50027,10007,50001,50013].includes(e.code))views.delete(key);else console.warn('[Live panels] Refresh retry:',e.code||e.name);}
  }
 }}finally{running=false;if(dirty.size)schedule();}}
function schedule(){if(timer||!client)return;timer=setTimeout(()=>{timer=null;flush().catch(e=>console.error('[Live panels]',e.message));},1500);timer.unref();}
function changed(guildId){if(!client)return;dirty.add(guildId);schedule();}
function init(c){if(client)return;client=c;c.on('guildMemberUpdate',(_old,m)=>changed(m.guild.id));setInterval(()=>{for(const [key,v]of views){if(v.expires<=Date.now())views.delete(key);else dirty.add(v.guildId);}schedule();},30000).unref();}
module.exports={tagged,render,attach,changed,init,status:guildId=>({views:[...views.values()].filter(v=>v.guildId===guildId).length,pending:dirty.size,failures:failures.get(guildId)||0})};

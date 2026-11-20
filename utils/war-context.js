const {read}=require('./war-state');
function current(guildId){const w=read().guilds[guildId]?.current;return w?{shard:'Able',id:w.warId,number:w.warNumber}:null;}
function resolve(guildId,label){
 const match=String(label||'').trim().match(/^(?:(?:able|live-1)\s*[-/:]?\s*)?(?:war\s*)?(\d+)$/i);
 if(!match)return null;const w=Object.values(read().guilds[guildId]?.wars||{}).find(w=>w.warNumber===Number(match[1]));return w?{shard:'Able',id:w.warId,number:w.warNumber}:null;
}
function same(a,b){return a.warRef&&b.warRef?a.warRef.shard===b.warRef.shard&&a.warRef.id===b.warRef.id:String(a.war||'').trim().toLowerCase()===String(b.war||'').trim().toLowerCase();}
function tag(guildId,record,label=record.war){if(record.warRef)return;const ref=label?resolve(guildId,label):current(guildId);if(ref)record.warRef=ref;}
function logistics(guildId,g,newIds=new Set()){
 for(const p of Object.values(g.stockpiles||{}))tag(guildId,p);
 for(const o of Object.values(g.orders||{})){
  if(o.warRef)continue;const piles=[o.sourceId,o.destinationId].filter(Boolean).map(id=>g.stockpiles[id]).filter(Boolean);
  if(piles.length){if(piles.every(p=>p.warRef&&same(p,piles[0])))o.warRef={...piles[0].warRef};}
  else if(newIds.has(o.id))tag(guildId,o);
 }
 for(const m of Object.values(g.manifests||{})){const orders=m.orderIds.map(id=>g.orders[id]);if(orders.length&&orders.every(o=>o?.warRef&&o.warRef.id===orders[0].warRef?.id&&o.warRef.shard===orders[0].warRef?.shard))m.warRef={...orders[0].warRef};else delete m.warRef;}
}
function matches(guildId,record,label){const ref=resolve(guildId,label),old=record.warRef||resolve(guildId,record.war);return ref&&old?ref.shard===old.shard&&ref.id===old.id:String(record.war||'').trim().toLowerCase()===String(label||'').trim().toLowerCase();}
module.exports={current,resolve,same,tag,logistics,matches};

// Verified HUSS emoji IDs also work before the Discord client is ready.
const guildId='1385714710405582858';
const ids={cross:'1570412785932832859',valor:'1570412876034744372',leadership:'1570412854027358208',guardian:'1570412808103923772',brother:'1570412736293118024',instructor:'1570412830761689169',campaign:'1570412763845758986'};
const fallback={cross:'🦅',valor:'⚔️',leadership:'🚩',guardian:'🛡️',brother:'🤝',instructor:'📜',campaign:'🎖️'};
let client;
function init(value){client=value;}
function component(award,serverId){
  const name=`huss_${award}`;
  const cache=client?.guilds?.cache?.get(serverId)?.emojis?.cache;
  const found=cache?.find(e=>e.name===name&&e.available!==false);
  if(found)return {id:found.id,name:found.name,animated:Boolean(found.animated)};
  if(!cache&&serverId===guildId&&Object.hasOwn(ids,award))return {id:ids[award],name,animated:false};
  return {name:fallback[award]||'🏅'};
}
function text(award,serverId){const e=component(award,serverId);return e.id?`<${e.animated?'a':''}:${e.name}:${e.id}>`:e.name;}
module.exports={init,component,text};

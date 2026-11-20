const path=require('node:path');
const fs=require('node:fs');
const awards=new Set(['cross','valor','leadership','guardian','brother','instructor','campaign']);
function decorate(payload,large=false,award=null){
  let name=awards.has(award)?`huss-${award}.png`:'huss-honours.png';
  const directory=path.join(__dirname,'..','assets','commendations');
  if(!fs.existsSync(path.join(directory,name)))name='huss-honours.png';
  const file=path.join(directory,name);
  if(!fs.existsSync(file)||!payload.embeds?.length)return payload;
  payload.embeds[0][large?'setImage':'setThumbnail'](`attachment://${name}`);
  return {...payload,attachments:[],files:[{attachment:file,name}]};
}
module.exports={decorate};

const fs=require('./data-fs'),path=require('node:path');
module.exports=name=>{
  const file=path.join(__dirname,'..','data',`${name}.json`);
  const read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{guilds:{}};
  const transact=(id,fn)=>{const data=read(),guild=data.guilds[id]||={};const result=fn(guild);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data,null,2));fs.renameSync(file+'.tmp',file);return result;};
  return {read,transact:(id,fn)=>fs.transaction?fs.transaction(()=>transact(id,fn)):transact(id,fn)};
};

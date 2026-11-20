const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..','data');let connection;
function enabled(){return process.env.HUSS_STORAGE_MODE==='sqlite';}
function key(file){if(typeof file!=='string'&&!Buffer.isBuffer(file))return null;const resolved=path.resolve(String(file));return path.dirname(resolved)===root&&/\.(json|jsonl)(\.tmp)?$/.test(resolved)?path.basename(resolved):null;}
function db(){if(!connection){const file=path.join(root,'huss.sqlite');if(!fs.existsSync(file))throw new Error('SQLite is not migrated. Stop HUSS and run the storage migration first.');connection=new (require('./sqlite-store').SqliteStore)(file);if(!connection.ready()||!connection.integrity()){connection.close();connection=null;throw new Error('SQLite migration or integrity check failed.');}}return connection;}
const api={...fs,
 existsSync(file){const k=key(file);return enabled()&&k?db().exists(k):fs.existsSync(file);},
 readFileSync(file,options){const k=key(file);if(!enabled()||!k)return fs.readFileSync(file,options);const text=db().read(k),encoding=typeof options==='string'?options:options?.encoding;return encoding?Buffer.from(text).toString(encoding):Buffer.from(text);},
 writeFileSync(file,content,options){const k=key(file);if(!enabled()||!k)return fs.writeFileSync(file,content,options);db().write(k,Buffer.isBuffer(content)?content.toString('utf8'):String(content));},
 appendFileSync(file,content,options){const k=key(file);if(!enabled()||!k)return fs.appendFileSync(file,content,options);db().append(k,String(content));},
 renameSync(source,target){const a=key(source),b=key(target);if(!enabled()||!a&&!b)return fs.renameSync(source,target);if(!a||!b)throw new Error('Cannot rename between SQLite and filesystem');return db().rename(a,b);},
 transaction(fn){return enabled()?db().transaction(fn):fn();},
 status(){if(!enabled())return {mode:'JSON (SQLite prepared for next war)',healthy:true};return {mode:'SQLite',healthy:db().integrity()};},
 bootstrap(){if(enabled())db();}
};module.exports=api;

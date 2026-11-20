// SQLite document storage preserves existing schemas while removing JSON file rewrites.
const fs=require('node:fs'),path=require('node:path');
class SqliteStore {
 constructor(file){if(!fs.existsSync(file)){const fd=fs.openSync(file,'wx',0o600);fs.closeSync(fd);}const {DatabaseSync}=require('node:sqlite');this.db=new DatabaseSync(file);this.depth=0;this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY,value TEXT NOT NULL);');}
 ready(){return this.db.prepare("SELECT value FROM metadata WHERE name='schema'").get()?.value==='1';}
 exists(name){return Boolean(this.db.prepare('SELECT 1 FROM documents WHERE name=?').get(name));}
 read(name){const row=this.db.prepare('SELECT body FROM documents WHERE name=?').get(name);if(!row){const e=new Error('Missing stored document: '+name);e.code='ENOENT';throw e;}return row.body;}
 write(name,body){if(name.endsWith('.json')||name.endsWith('.json.tmp'))JSON.parse(body);this.db.prepare('INSERT INTO documents VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at').run(name,String(body),Date.now());}
 append(name,body){this.db.prepare("INSERT INTO documents VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET body=documents.body||excluded.body,updated_at=excluded.updated_at").run(name,String(body),Date.now());}
 transaction(fn){if(this.depth)return fn();this.db.exec('BEGIN IMMEDIATE');this.depth++;try{const result=fn();if(result?.then)throw new Error('SQLite transactions must be synchronous');this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}finally{this.depth--;}}
 rename(source,target){return this.transaction(()=>{this.write(target,this.read(source));this.db.prepare('DELETE FROM documents WHERE name=?').run(source);});}
 integrity(){return this.db.prepare('PRAGMA quick_check').get().quick_check==='ok';}
 backup(destination){if(fs.existsSync(destination))throw new Error('Backup destination already exists');this.db.prepare('VACUUM INTO ?').run(path.resolve(destination));fs.chmodSync(destination,0o600);}
 importDirectory(directory){if(this.ready())throw new Error('Database already initialized; never overwrite a live database.');const names=fs.readdirSync(directory).filter(n=>/\.(json|jsonl)$/.test(n));this.transaction(()=>{for(const name of names)this.write(name,fs.readFileSync(path.join(directory,name),'utf8'));this.db.prepare("INSERT INTO metadata VALUES('schema','1')").run();this.db.prepare("INSERT INTO metadata VALUES('imported_at',?)").run(String(Date.now()));});return names.length;}
 exportDirectory(directory){if(fs.existsSync(directory))throw new Error('Export directory already exists; choose a new path.');fs.mkdirSync(directory,{recursive:true});for(const row of this.db.prepare('SELECT name,body FROM documents').all()){if(row.name.endsWith('.tmp'))continue;if(path.basename(row.name)!==row.name)throw new Error('Invalid stored filename');fs.writeFileSync(path.join(directory,row.name),row.body);}}
 close(){this.db.close();}
}
module.exports={SqliteStore};

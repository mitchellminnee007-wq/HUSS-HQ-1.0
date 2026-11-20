// Run with HUSS stopped for migration/export. Never switch back to stale JSON after SQLite writes.
const path=require('node:path'),fs=require('node:fs');const {SqliteStore}=require('../utils/sqlite-store');
const [action,databaseArg,destination]=process.argv.slice(2);const root=path.resolve(__dirname,'..','data'),file=databaseArg?path.resolve(databaseArg):path.join(root,'huss.sqlite');
if(!['migrate','check','backup','export'].includes(action))throw new Error('Usage: node scripts/storage.js migrate|check|backup|export [database] [destination]');
if(action!=='migrate'&&!fs.existsSync(file))throw new Error('Database does not exist');
fs.mkdirSync(path.dirname(file),{recursive:true});const db=new SqliteStore(file);
try{if(action==='migrate'){const count=db.importDirectory(root);if(!db.integrity())throw new Error('Integrity check failed');console.log(`Migrated and verified ${count} documents. Original JSON files preserved. Set HUSS_STORAGE_MODE=sqlite only after stopping HUSS and backing up data.`);}else if(action==='check'){if(!db.ready()||!db.integrity())throw new Error('Storage check failed');console.log('SQLite migration and integrity verified');}else{if(!destination)throw new Error('Supply a new destination path');if(action==='backup')db.backup(destination);else db.exportDirectory(destination);console.log(action+' complete');}}finally{db.close();}

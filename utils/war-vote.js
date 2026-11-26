const {randomUUID}=require('node:crypto');
const db=require('./atomic-json')('war-votes');
const open=(p,now=Date.now())=>p.status==='open'&&p.closesAt>now;
function create(g,title,options,hours,userId,now=Date.now()){
 g.polls||={};
 if(Object.values(g.polls).some(p=>open(p,now)||p.status==='publishing'))throw Error('Close the current vote before starting another.');
 title=String(title||'').trim();options=options.map(o=>String(o).trim());
 if(!title||title.length>180||options.length<2||options.length>5||options.some(o=>!o||o.length>200)||new Set(options.map(o=>o.toLowerCase())).size!==options.length)throw Error('Use a title and 2–5 different options (up to 200 characters each).');
 if(!Number.isInteger(hours)||hours<1||hours>336)throw Error('Choose a duration between 1 and 336 hours.');
 const p={id:randomUUID().slice(0,12),title,options,votes:{},createdBy:userId,createdAt:now,closesAt:now+hours*3600000,status:'publishing'};
 g.polls[p.id]=p;return p;
}
function get(g,id){const p=g.polls?.[id];if(!p)throw Error('Vote not found.');return p;}
function cast(p,userId,choice,now=Date.now()){
 if(!open(p,now))throw Error('This vote is closed.');
 if(!Number.isInteger(choice)||choice<0||choice>=p.options.length)throw Error('Invalid choice.');
 p.votes[userId]=choice;
}
function counts(p){return p.options.map((_,i)=>Object.values(p.votes).filter(v=>v===i).length);}
function draft(g,input,userId,now=Date.now()){
 g.polls||={};
 if(Object.values(g.polls).filter(p=>p.status==='draft'&&p.createdBy===userId).length>=10)throw Error('Publish or discard an existing draft first.');
 const p=create({},input.title,input.options,input.hours,userId,now);
 if(!['goal','deployment','custom'].includes(input.kind))throw Error('Unknown vote type.');
 if(String(input.context||'').length>1000)throw Error('Context must be at most 1000 characters.');
 Object.assign(p,{status:'draft',hours:input.hours,kind:input.kind,context:String(input.context||'').trim(),revision:1});
 g.polls[p.id]=p;return p;
}
function reserve(g,id,userId,revision,now=Date.now()){
 const p=get(g,id);
 if(p.status!=='draft'||p.createdBy!==userId||p.revision!==revision)throw Error('This draft has changed or is not yours. Open its latest preview.');
 if(Object.values(g.polls).some(x=>x.id!==id&&(open(x,now)||x.status==='publishing')))throw Error('Close the current vote before publishing another.');
 p.status='publishing';p.closesAt=now+p.hours*3600000;return p;
}
function withdraw(p,userId,now=Date.now()){if(!open(p,now))throw Error('This vote is closed.');delete p.votes[userId];}
function decide(p,choice,note,userId,now=Date.now()){
 if(open(p,now)||!['open','closed'].includes(p.status))throw Error('Close voting before recording a decision.');
 if(p.decision)throw Error('The Commander decision has already been recorded.');
 if(!Number.isInteger(choice)||choice<0||choice>=p.options.length)throw Error('Choose a listed option.');
 note=String(note||'').trim();if(!note||note.length>1000)throw Error('Give a decision explanation (1–1000 characters).');
 p.status='closed';p.decision={choice,note,userId,at:now};return p;
}
module.exports={...db,open,create,get,cast,counts,draft,reserve,withdraw,decide};

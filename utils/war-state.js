const db=require('./atomic-json')('warflow');
const WINDOW=48*3600000;
function observe(g,w,now=Date.now()){
 if(!w||typeof w.warId!=='string'||!Number.isInteger(w.warNumber)||!['NONE','WARDENS','COLONIALS'].includes(w.winner))throw new Error('Invalid War API response');
 for(const key of ['conquestStartTime','conquestEndTime'])if(w[key]!==null&&(!Number.isSafeInteger(w[key])||w[key]<=0||w[key]>now))throw new Error('Invalid war timestamps');
 if(w.conquestEndTime&&(!w.conquestStartTime||w.conquestEndTime<w.conquestStartTime))throw new Error('Invalid end time');
 g.wars||={};if(g.current&&g.current.warId!==w.warId&&!g.wars[g.current.warId]?.conquestEndTime)g.missedEnd=g.current.warId;
 const saved=g.wars[w.warId]||{};
 // Preserve a confirmed end across stale API responses.
 const record={...w,...saved,conquestStartTime:w.conquestStartTime||saved.conquestStartTime||null,conquestEndTime:saved.conquestEndTime||w.conquestEndTime,winner:saved.conquestEndTime?saved.winner:w.winner};
 g.wars[w.warId]=record;g.current=record;g.lastPoll=now;delete g.error;return record;
}
function ready(w,now=Date.now()){return Boolean(w?.conquestEndTime&&w.activity?.status==='open'&&now>=w.conquestEndTime+WINDOW&&now>=w.activity.endsAt&&w.rollover!=='done'&&w.rollover!=='running');}
function activity(w,actor,now=Date.now()){if(!w?.conquestEndTime)throw new Error('War end has not been confirmed by the API.');if(w.activity)throw new Error('An activity check already exists; recover or cancel it first.');w.activity={status:'starting',approvedBy:actor,approvedAt:now,endsAt:now+WINDOW,respondents:[]};return w.activity;}
module.exports={...db,WINDOW,observe,ready,activity};

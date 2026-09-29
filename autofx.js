/* =========================================================
   محرك القدرات التلقائي
   يقرأ نص القدرة الرسمي (بالإنجليزية) لكل بطاقة لم تُبرمج يدوياً، ويحوّل
   الأنماط الشائعة إلى تأثيرات تعمل فعلاً + وصف عربي. الأجزاء غير المدعومة
   تُعرض بنصها الأصلي ولا تُنفَّذ.
   ========================================================= */
const AF_TIMINGS = {
  'on play':'onPlay', 'when attacking':'whenAtk', 'activate: main':'act', 'on ko':'onKO', 'counter':'counter', 'main':'main',
  'on block':'onBlock', 'end of your turn':'endTurn', "on your opponent's attack":'oppAtk', 'trigger':'trigger',
};
const AF_MODS = ['once per turn','your turn',"opponent's turn"];
const AF_KW = {'blocker':'blocker','rush':'rush','rush: character':'rc','banish':'ban','double attack':'double','unblockable':'unblockable'};
const AF_TIM_AR = {onPlay:'عند اللعب', whenAtk:'عند الهجوم', act:'تفعيل رئيسي', onKO:'عند الإقصاء', counter:'مضاد', main:'رئيسي',
  onBlock:'عند الصد', endTurn:'نهاية دورك', oppAtk:'عند هجوم الخصم', trigger:'تريغر', static:'مستمر'};
const AF_COL = {red:'red',green:'green',blue:'blue',purple:'purple',black:'black',yellow:'yellow'};
const AF_STATS = {cards:0, full:0, partial:0, none:0, clauses:0, parsed:0};
const AF_MISS = [];   // للتشخيص: الأجزاء غير المدعومة

function afNorm(s){
  return (s||'').replace(/K\.O\.'d/gi,'KOd').replace(/K\.O\./gi,'KO').replace(/[−–—]/g,'-').replace(/\([^)]*\)/g,'')
    .replace(/[①-⑩]/g, ch=>` {REST ${ch.charCodeAt(0)-0x245F}} `)
    .replace(/[➀-➉]/g, ch=>` {REST ${ch.charCodeAt(0)-0x277F}} `)
    .replace(/\s+/g,' ').trim();
}
// يقسم النص إلى كتل: [وسوم] + نص
function afBlocks(text){
  const blocks=[]; let cur={tags:[], body:''};
  const re=/\[([^\]]+)\]/g; let last=0, m;
  const isTag = t => { const l=t.toLowerCase(); return AF_TIMINGS[l]||AF_MODS.includes(l)||AF_KW[l]||/^don!! x\d+$/.test(l); };
  while ((m=re.exec(text))){
    const before=text.slice(last, m.index); last=re.lastIndex;
    const tag=m[1];
    const boundary = cur.body.trim()==='' ? true : /[.:]\s*$/.test((cur.body+before).trim());
    if (isTag(tag) && boundary && before.replace(/[\s\/]/g,'')===''){
      if (cur.body.trim()){ blocks.push(cur); cur={tags:[], body:''}; }
      cur.tags.push(tag.toLowerCase());
    } else if (isTag(tag) && boundary && cur.body.trim() && /[.]\s*$/.test((cur.body+before).trim())){
      cur.body+=before; blocks.push(cur); cur={tags:[tag.toLowerCase()], body:''};
    } else { cur.body+=before+m[0]; }
  }
  cur.body+=text.slice(last); if (cur.tags.length||cur.body.trim()) blocks.push(cur);
  return blocks;
}

/* ---------- المرشّحات ---------- */
function afCharFilter(s){ // مرشّح لشخصية في الملعب
  const f=[], ar=[]; s=' '+s.toLowerCase()+' ';
  let m;
  if (/ rested /.test(s)){ f.push(x=>x.rested); ar.push('مستريحة'); }
  if (/ active /.test(s)){ f.push(x=>!x.rested); ar.push('نشطة'); }
  if ((m=s.match(/with a base cost of (\d+) or less/))){ const v=+m[1]; f.push(x=>x.def.cost<=v); ar.push(`تكلفتها الأساسية ≤ ${v}`); }
  else if ((m=s.match(/with a cost of (\d+) or less/))){ const v=+m[1]; f.push(x=>costOf(x)<=v); ar.push(`تكلفتها ≤ ${v}`); }
  else if ((m=s.match(/with a cost of (\d+) or more/))){ const v=+m[1]; f.push(x=>costOf(x)>=v); ar.push(`تكلفتها ≥ ${v}`); }
  else if ((m=s.match(/with a cost of (\d+)\b/))){ const v=+m[1]; f.push(x=>costOf(x)===v); ar.push(`تكلفتها ${v}`); }
  else if (/cost equal to or less than the number of your opponent's life cards/.test(s)){ f.push((x)=>costOf(x)<=P(x.owner).life.length); ar.push('تكلفتها ≤ عدد بطاقات حياة صاحبها'); }
  if ((m=s.match(/with (\d+) base power or less/))){ const v=+m[1]; f.push(x=>basePower(x)<=v); ar.push(`قوتها الأساسية ≤ ${v}`); }
  else if ((m=s.match(/with (\d+) power or less/))){ const v=+m[1]; f.push(x=>power(x)<=v); ar.push(`قوتها ≤ ${v}`); }
  else if ((m=s.match(/with (\d+) power or more/))){ const v=+m[1]; f.push(x=>power(x)>=v); ar.push(`قوتها ≥ ${v}`); }
  const types=[...s.matchAll(/\{([^}]+)\}/g), ...s.matchAll(/type including "([^"]+)"/g)].map(x=>x[1]);
  if (types.length){ f.push(x=>types.some(t=>x.def.types.some(y=>y.toLowerCase().includes(t)))); ar.push(`من نوع ${types.join(' أو ')}`); }
  if ((m=s.match(/other than \[([^\]]+)\]/))){ const nme=m[1]; f.push(x=>x.def.en.toLowerCase()!==nme); ar.push(`غير ${nme}`); }
  else if ((m=s.match(/^\s*\[([^\]]+)\]/))){ const nme=m[1]; f.push(x=>x.def.en.toLowerCase()===nme); ar.push(`[${nme}]`); }
  if (/with a \[trigger\]/.test(s)){ f.push(x=>!!FX_(x).trigger); ar.push('تحمل تريغر'); }
  if (/cost equal to or less than the total of your and your opponent's life cards/.test(s)){ f.push(x=>costOf(x)<=P(0).life.length+P(1).life.length); ar.push('تكلفتها ≤ مجموع بطاقات الحياة'); }
  return {fn:x=>f.every(g=>g(x)), ar:ar.join('، ')};
}
function afCardFilter(s){ // مرشّح لبطاقة في اليد/المقبرة/المجموعة
  const f=[], ar=[]; const l=' '+s.toLowerCase()+' '; let m;
  if ((m=l.match(/^ \[([^\]]+)\]/))){ const nme=m[1]; f.push(x=>x.def.en.toLowerCase()===nme); ar.push(`[${nme}]`); }
  const types=[...l.matchAll(/\{([^}]+)\}/g), ...l.matchAll(/type including "([^"]+)"/g)].map(x=>x[1]);
  if (types.length){ f.push(x=>types.some(t=>x.def.types.some(y=>y.toLowerCase().includes(t)))); ar.push(`من نوع ${types.join(' أو ')}`); }
  const cols=Object.keys(AF_COL).filter(c=>new RegExp(' '+c+' ').test(l));
  if (cols.length){ f.push(x=>cols.some(c=>x.def.colors.includes(c))); ar.push(cols.map(c=>COLOR_AR[c]).join('/')); }
  if (/ character /.test(l)){ f.push(x=>x.def.t==='C'); ar.unshift('شخصية'); }
  else if (/ event /.test(l)){ f.push(x=>x.def.t==='E'); ar.unshift('حدث'); }
  else if (/ stage /.test(l)){ f.push(x=>x.def.t==='S'); ar.unshift('مرحلة'); }
  else if (!ar.length || !/^\s\[/.test(l)) ar.unshift('بطاقة');
  if ((m=l.match(/other than \[([^\]]+)\]/))){ const nme=m[1]; f.push(x=>x.def.en.toLowerCase()!==nme); ar.push(`غير ${nme}`); }
  if ((m=l.match(/with a cost of (\d+) or less/))){ const v=+m[1]; f.push(x=>x.def.cost<=v); ar.push(`تكلفتها ≤ ${v}`); }
  else if ((m=l.match(/with a cost of (\d+) or more/))){ const v=+m[1]; f.push(x=>x.def.cost>=v); ar.push(`تكلفتها ≥ ${v}`); }
  else if ((m=l.match(/with a cost of (\d+)\b/))){ const v=+m[1]; f.push(x=>x.def.cost===v); ar.push(`تكلفتها ${v}`); }
  if ((m=l.match(/with (\d+) power or less/))){ const v=+m[1]; f.push(x=>x.def.power<=v); ar.push(`قوتها ≤ ${v}`); }
  if (/with a \[trigger\]/.test(l)){ f.push(x=>!!FX_(x).trigger); ar.push('تحمل تريغر'); }
  return {fn:x=>f.every(g=>g(x)), ar:ar.join(' ')};
}

/* ---------- الشروط ---------- */
function afCond(s){
  const parts=s.toLowerCase().split(/ and (?=you |your |there )/); const fs=[], ar=[];
  for (const q of parts){
    let m, fn=null, a='';
    if ((m=q.match(/your leader has the \{([^}]+)\} type/))){ const t=m[1]; fn=p=>ldr(p).def.types.some(y=>y.toLowerCase().includes(t)); a=`قائدك من نوع ${t}`; }
    else if ((m=q.match(/your leader(?:'s type)? includes? "([^"]+)"/))){ const t=m[1].toLowerCase(); fn=p=>ldr(p).def.types.some(y=>y.toLowerCase().includes(t)); a=`قائدك من نوع ${t}`; }
    else if ((m=q.match(/your leader is \[([^\]]+)\]/))){ const nme=m[1]; fn=p=>ldr(p).def.en.toLowerCase()===nme||(!!ldr(p).def.like&&DB[ldr(p).def.like].en.toLowerCase()===nme); a=`قائدك هو ${nme}`; }
    else if (/your leader is multicolored/.test(q)){ fn=p=>ldr(p).def.colors.length>1; a='قائدك متعدد الألوان'; }
    else if ((m=q.match(/you and your opponent have a total of (\d+) or less life cards/))){ const v=+m[1]; fn=p=>P(p).life.length+P(1-p).life.length<=v; a=`مجموع الحياة ≤ ${v}`; }
    else if ((m=q.match(/your opponent has (\d+) or less life cards/))){ const v=+m[1]; fn=p=>P(1-p).life.length<=v; a=`حياة الخصم ≤ ${v}`; }
    else if ((m=q.match(/your opponent has (\d+) or more life cards/))){ const v=+m[1]; fn=p=>P(1-p).life.length>=v; a=`حياة الخصم ≥ ${v}`; }
    else if ((m=q.match(/you have (\d+) or less life cards/))){ const v=+m[1]; fn=p=>P(p).life.length<=v; a=`حياتك ≤ ${v}`; }
    else if ((m=q.match(/you have (\d+) or more life cards/))){ const v=+m[1]; fn=p=>P(p).life.length>=v; a=`حياتك ≥ ${v}`; }
    else if ((m=q.match(/you have (\d+) or more don!! cards on your field/))){ const v=+m[1]; fn=p=>donTotal(p)>=v; a=`لديك ${v}+ DON!!`; }
    else if ((m=q.match(/you have (\d+) or less don!! cards on your field/))){ const v=+m[1]; fn=p=>donTotal(p)<=v; a=`لديك ≤ ${v} DON!!`; }
    else if ((m=q.match(/you have (\d+) or less cards in your hand/))){ const v=+m[1]; fn=p=>P(p).hand.length<=v; a=`يدك ≤ ${v}`; }
    else if ((m=q.match(/you have (\d+) or more cards in your hand/))){ const v=+m[1]; fn=p=>P(p).hand.length>=v; a=`يدك ≥ ${v}`; }
    else if ((m=q.match(/you have (\d+) or more rested characters/))){ const v=+m[1]; fn=p=>P(p).chars.filter(x=>x.rested).length>=v; a=`لديك ${v}+ شخصيات مستريحة`; }
    else if ((m=q.match(/you have (\d+) or more characters/))){ const v=+m[1]; fn=p=>P(p).chars.length>=v; a=`لديك ${v}+ شخصيات`; }
    else if ((m=q.match(/you have (\d+) or less characters/))){ const v=+m[1]; fn=p=>P(p).chars.length<=v; a=`لديك ≤ ${v} شخصيات`; }
    else if ((m=q.match(/your opponent has (\d+) or more characters/))){ const v=+m[1]; fn=p=>P(1-p).chars.length>=v; a=`لدى الخصم ${v}+ شخصيات`; }
    else if ((m=q.match(/your opponent has (\d+) or more rested characters/))){ const v=+m[1]; fn=p=>P(1-p).chars.filter(x=>x.rested).length>=v; a=`لدى الخصم ${v}+ شخصيات مستريحة`; }
    else if ((m=q.match(/your opponent has a character with (\d+) power or more/))){ const v=+m[1]; fn=p=>P(1-p).chars.some(x=>power(x)>=v); a=`لدى الخصم شخصية بقوة ${v}+`; }
    else if ((m=q.match(/there is a character with a cost of (\d+) or more/))){ const v=+m[1]; fn=()=>G.players.some(pl=>pl.chars.some(x=>costOf(x)>=v)); a=`توجد شخصية تكلفتها ${v}+`; }
    else if (/this character is rested/.test(q)){ fn=(p,c)=>!!c&&c.rested; a='هذه الشخصية مستريحة'; }
    else if ((m=q.match(/you have (\d+) or more events? in your trash/))){ const v=+m[1]; fn=p=>P(p).trash.filter(x=>x.def.t==='E').length>=v; a=`في مقبرتك ${v}+ أحداث`; }
    else if ((m=q.match(/you have (\d+) or more cards in your trash/))){ const v=+m[1]; fn=p=>P(p).trash.length>=v; a=`في مقبرتك ${v}+ بطاقات`; }
    else if ((m=q.match(/you have (\d+) or less cards in your deck/))){ const v=+m[1]; fn=p=>P(p).deck.length<=v; a=`مجموعتك ≤ ${v}`; }
    else if ((m=q.match(/you have a (?:\{([^}]+)\} type )?character with a cost of (\d+) or more/))){ const t=m[1], v=+m[2]; fn=p=>P(p).chars.some(x=>costOf(x)>=v&&(!t||x.def.types.some(y=>y.toLowerCase().includes(t)))); a=`لديك شخصية تكلفتها ${v}+`; }
    else if ((m=q.match(/you have a (?:\{([^}]+)\} type )?character with (\d+) power or more/))){ const t=m[1], v=+m[2]; fn=p=>P(p).chars.some(x=>power(x)>=v&&(!t||x.def.types.some(y=>y.toLowerCase().includes(t)))); a=`لديك شخصية بقوة ${v}+`; }
    else if (/the number of your life cards is equal to or less than the number of your opponent's/.test(q)){ fn=p=>P(p).life.length<=P(1-p).life.length; a='حياتك ≤ حياة الخصم'; }
    else if (/the number of don!! cards on your field is equal to or less than the number on your opponent's field/.test(q)){ fn=p=>donTotal(p)<=donTotal(1-p); a='DON!! لديك ≤ الخصم'; }
    else if ((m=q.match(/your opponent has (\d+) or more don!! cards on their field/))){ const v=+m[1]; fn=p=>donTotal(1-p)>=v; a=`لدى الخصم ${v}+ DON!!`; }
    else if ((m=q.match(/you have (\d+) or more \{([^}]+)\} type characters/))){ const v=+m[1], t=m[2]; fn=p=>P(p).chars.filter(x=>x.def.types.some(y=>y.toLowerCase().includes(t))).length>=v; a=`لديك ${v}+ شخصيات ${t}`; }
    else if ((m=q.match(/your leader is \{([^}]+)\} type/))){ const t=m[1]; fn=p=>ldr(p).def.types.some(y=>y.toLowerCase().includes(t)); a=`قائدك من نوع ${t}`; }
    else if (/it is your turn/.test(q)){ fn=p=>G.turnPlayer===p; a='في دورك'; }
    if (!fn) return null;
    fs.push(fn); ar.push(a);
  }
  return {fn:(p,c)=>fs.every(g=>g(p,c)), ar:ar.join(' و')};
}

/* ---------- الأفعال ---------- */
const afUp = (n,x) => n>1?`حتى ${n} ${x}`:x;
function afAction(cl, ctx){
  const s=cl.toLowerCase().replace(/\.$/,'').trim(); let m;
  const R=(ar, run, extra={})=>({ar, run, ...extra});
  if ((m=s.match(/^draw (\d+) cards?$/))){ const n=+m[1]; return R(`اسحب ${n}`, async p=>{ draw(p,n); }); }
  if ((m=s.match(/^(?:you may )?trash (\d+) cards? from your hand$/))){ const n=+m[1]; return R(`ارمِ ${n} من يدك`, async p=>{ await trashOwn(p,n); }); }
  if ((m=s.match(/^your opponent trashes (\d+) cards? from their hand$/))){ const n=+m[1]; return R(`يرمي الخصم ${n} من يده`, async p=>{ await trashOwn(1-p,n); }); }
  if ((m=s.match(/^trash (\d+) cards? from the top of your deck$/))){ const n=+m[1]; return R(`ارمِ أعلى ${n} من مجموعتك`, async p=>{ const pl=P(p); for (let i=0;i<n&&pl.deck.length;i++) pl.trash.push(pl.deck.pop()); }); }
  if ((m=s.match(/^ko up to (\d+) of your opponent's stages?$/))) return R('أقصِ مرحلة للخصم', async p=>{ const o=P(1-p); if (o.stage){ const st=o.stage; removeFromField(st); o.trash.push(st); sfx('ko'); } });
  if ((m=s.match(/^ko up to (\d+) of your opponent's (.*?)characters?(.*)$/))){ const n=+m[1], F=afCharFilter(m[2]+' '+m[3]);
    return R(`أقصِ ${afUp(n,'شخصية')} للخصم${F.ar?' ('+F.ar+')':''}`, async p=>{ const ts=await pickOpp(p,F.fn,n,`أقصِ ${afUp(n,'شخصية')} ${F.ar}`); for (const t of ts) await koEffect(t,p); }, {aiv:1}); }
  if ((m=s.match(/^ko all (?:of your opponent's )?characters(.*)$/))){ const F=afCharFilter(m[1]); const opp=/opponent/.test(s);
    return R(`أقصِ كل ${opp?'شخصيات الخصم':'الشخصيات'} ${F.ar}`, async (p,c)=>{ const ts=[...P(1-p).chars,...(opp?[]:P(p).chars.filter(x=>x!==c))].filter(F.fn); for (const t of ts) await koEffect(t,p); }); }
  if ((m=s.match(/^rest up to (\d+) of your opponent's don!! cards?$/))){ const n=+m[1]; return R(`أرح ${n} DON!! للخصم`, async p=>{ const o=P(1-p); const k=Math.min(n,o.donActive); o.donActive-=k; o.donRested+=k; }); }
  if ((m=s.match(/^rest up to (\d+) of your opponent's (.*?)(leader or character cards|characters?)(.*)$/))){ const n=+m[1], F=afCharFilter(m[2]+' '+m[4]); const lead=/leader/.test(m[3]);
    return R(`أرح ${afUp(n,lead?'قائداً أو شخصية':'شخصية')} للخصم${F.ar?' ('+F.ar+')':''}`, async p=>{ const cands=[...(lead?[ldr(1-p)]:[]),...P(1-p).chars].filter(x=>!x.rested&&F.fn(x)); const ts=await pickCards(p,cands,{title:'أرح بطاقة للخصم',max:n}); ts.forEach(restCard); }); }
  if ((m=s.match(/^give all of your opponent's characters -(\d+) (power|cost)(?: during this turn)?$/))){ const v=+m[1], pw=m[2]==='power';
    return R(`كل شخصيات الخصم −${v} ${pw?'قوة':'تكلفة'} هذا الدور`, async p=>{ P(1-p).chars.forEach(x=> pw?debuff(x,v):addMod(x,{k:'cost',v:-v,until:thisTurn()})); }); }
  if ((m=s.match(/^give up to (\d+) of your opponent's (leader or character cards|characters?|leader)(.*?) -(\d+) power(?: during this turn)?$/))){ const n=+m[1], v=+m[4], lead=/leader/.test(m[2]), F=afCharFilter(m[3]);
    return R(`أعطِ ${afUp(n,lead?'قائد الخصم أو شخصية':'شخصية للخصم')} −${v} قوة هذا الدور`, async p=>{ const b=G.battle; const cands=[...(lead?[ldr(1-p)]:[]),...(/^leader$/.test(m[2])?[]:P(1-p).chars.filter(F.fn))];
      const ts=await pickCards(p,cands,{title:`−${v} قوة`,max:n,ai:x=>b&&x===b.attacker?99:power(x)}); ts.forEach(t=>debuff(t,v)); }, {v}); }
  if ((m=s.match(/^give up to (\d+) of your opponent's characters?(.*?) -(\d+) cost(?: during this turn)?$/))){ const n=+m[1], v=+m[3];
    return R(`أعطِ ${afUp(n,'شخصية للخصم')} −${v} تكلفة هذا الدور`, async p=>{ const ts=await pickOpp(p,()=>true,n,`−${v} تكلفة`); ts.forEach(t=>addMod(t,{k:'cost',v:-v,until:thisTurn()})); }); }
  if ((m=s.match(/^up to (\d+) of your (leader or character cards|leader or characters|characters?|leader)(.*?) gains? \+(\d+) power(?: during this (turn|battle))?$/))){ const n=+m[1], v=+m[4], battle=m[5]==='battle', lead=/leader/.test(m[2]), onlyL=m[2]==='leader', F=afCharFilter(m[3]);
    return R(`${lead?'قائدك أو شخصيتك':'شخصيتك'} +${v} قوة ${battle?'في المعركة':'هذا الدور'}`, async p=>{ const d=defender();
      const cands=[...(lead?[ldr(p)]:[]),...(onlyL?[]:P(p).chars.filter(F.fn))]; const ts=await pickCards(p,cands,{title:`+${v} قوة`,max:n,ai:x=>x===d?99:atkMode(x)?power(x)+50000:power(x)});
      ts.forEach(t=> battle&&G.battle ? battleBuff(t,v) : buffTurn(t,v)); }, {v: battle?v:0}); }
  if ((m=s.match(/^your leader gains \+(\d+) power(?: during this (turn|battle))?$/))){ const v=+m[1], battle=m[2]==='battle';
    return R(`قائدك +${v} قوة ${battle?'في المعركة':'هذا الدور'}`, async p=>{ battle&&G.battle ? battleBuff(ldr(p),v) : buffTurn(ldr(p),v); }, {v: battle?v:0, leaderOnly:true}); }
  if ((m=s.match(/^this (?:character|leader|card) gains \+(\d+) power(?: during this (turn|battle))?$/))){ const v=+m[1], battle=m[2]==='battle';
    return R(`+${v} قوة لهذه البطاقة`, async (p,c)=>{ if (c && isOnField(c)) (battle&&G.battle?battleBuff(c,v):buffTurn(c,v)); }); }
  if ((m=s.match(/^this character gains \[(rush|blocker|double attack|banish|unblockable)\](?: during this turn)?$/))){ const k=AF_KW[m[1]];
    return R(`تحصل على ${m[1]} هذا الدور`, async (p,c)=>{ if (c) giveKw(c,k); }); }
  if ((m=s.match(/^up to (\d+) of your (.*?)characters?(.*?) gains? \[(rush|blocker|double attack|banish|unblockable)\](?: during this turn)?$/))){ const n=+m[1], k=AF_KW[m[4]], F=afCharFilter(m[2]+' '+m[3]);
    return R(`${afUp(n,'شخصية')} لك تحصل على ${m[4]} هذا الدور`, async p=>{ const ts=await pickCards(p,P(p).chars.filter(F.fn),{title:m[4],max:n,ai:x=>power(x)}); ts.forEach(t=>giveKw(t,k)); }); }
  if ((m=s.match(/^return up to (\d+) (?:of your opponent's )?characters?(.*?) to the owner's hand$/))){ const n=+m[1], F=afCharFilter(m[2]); const oppOnly=/opponent/.test(s);
    return R(`أعد ${afUp(n,'شخصية')}${F.ar?' ('+F.ar+')':''} إلى يد صاحبها`, async p=>{ const b=G.battle; const cands=[...P(1-p).chars,...(oppOnly?[]:P(p).chars)].filter(F.fn);
      const ts=await pickCards(p,cands,{title:'أعد شخصية إلى اليد',max:n,ai:x=>x.owner===p?-9:(b&&x===b.attacker?99:costOf(x))}); for (const t of ts) await bounce(t,p); }, {bounce:F}); }
  if ((m=s.match(/^place up to (\d+) (?:of your opponent's )?characters?(.*?) at the bottom of the owner's deck$/))){ const n=+m[1], F=afCharFilter(m[2]);
    return R(`ضع ${afUp(n,'شخصية')}${F.ar?' ('+F.ar+')':''} أسفل مجموعة صاحبها`, async p=>{ const cands=[...P(1-p).chars,...P(p).chars].filter(F.fn);
      const ts=await pickCards(p,cands,{title:'أسفل المجموعة',max:n,ai:x=>x.owner===p?-9:costOf(x)}); for (const t of ts) await bottomDeck(t,p); }); }
  if ((m=s.match(/^add up to (\d+) don!! cards? from your don!! deck and (rest (?:it|them)|set (?:it|them) as active)$/))){ const n=+m[1], act=/active/.test(m[2]);
    return R(`أضف ${n} DON!! ${act?'نشطة':'مستريحة'}`, async p=>addDon(p,n,act)); }
  if ((m=s.match(/^set up to (\d+) of your don!! cards as active$/))){ const n=+m[1]; return R(`اجعل ${n} DON!! نشطة`, async p=>setDonActive(p,n)); }
  if ((m=s.match(/^give (?:up to )?(\d+) rested don!! cards? to (your leader or \d+ of your characters|your leader|\d+ of your characters|this character)$/)) ||
      (m=s.match(/^give (this leader or \d+ of your characters|your leader or \d+ of your characters) up to (\d+) rested don!! cards?$/))){
    const n=+(isNaN(+m[1])?m[2]:m[1]), who=(isNaN(+m[1])?m[1]:m[2]);
    return R(`أرفق ${n} DON!! مستريحة`, async (p,c)=>{ let t; if (/this character/.test(who)) t=c; else if (who==='your leader') t=ldr(p); else t=await pickOwn(p,x=>/leader/.test(who)||x.def.t==='C','اختر من تُرفق به DON!!'); if (t) giveRested(p,t,n); }); }
  if ((m=s.match(/^look at (\d+) cards from the top of your deck; reveal up to (\d+) (.+?) and add (?:it|them) to your hand$/))){ const n=+m[1], F=afCardFilter(m[3]);
    const act=R(`انظر إلى أعلى ${n} وخذ ${F.ar}`, async p=>{ await lookTop(p,n,F.fn,act.restTo||'bottom',F.ar); }); return act; }
  if ((m=s.match(/^look at (\d+) cards from the top of your deck and place them at the top or bottom of the deck in any order$/))){ const n=+m[1]; return R(`رتّب أعلى ${n} بطاقات`, async p=>scry(p,n)); }
  if (/^(place the rest at the bottom of your deck in any order|then, place the rest at the bottom of your deck in any order)$/.test(s)) return R('', async()=>{}, {noop:true});
  if (/^trash the rest$/.test(s)) return R('', async()=>{}, {trashRest:true});
  if ((m=s.match(/^play up to (\d+) (.+?) from your (hand or trash|hand|trash)( rested)?$/))){ const F=afCardFilter(m[2]), from=m[3], rested=!!m[4];
    return R(`العب ${F.ar} من ${from==='hand'?'يدك':from==='trash'?'مقبرتك':'يدك أو مقبرتك'}${rested?' مستريحة':''}`, async p=>{ const pl=P(p);
      const pool=[...(from!=='trash'?pl.hand:[]),...(from!=='hand'?pl.trash:[])].filter(x=>x.def.t!=='L'&&x.def.t!=='E'&&F.fn(x));
      const [t]=await pickCards(p,pool,{title:`العب ${F.ar}`,ai:x=>x.def.cost}); if (t){ await playFrom(p,t,pl.hand.includes(t)?'hand':'trash'); if (rested) t.rested=true; } }); }
  if (/^play this card$/.test(s)) return R('العب هذه البطاقة', async()=>{}, {playSelf:true});
  if ((m=s.match(/^activate this card's \[(main|counter)\] effect$/))){ const k=m[1]; return R(`فعّل تأثير [${k==='main'?'رئيسي':'مضاد'}] لهذه البطاقة`, async (p,c)=>{ const f=FX_(c)[k]; if (f&&f.run) await f.run(p,c); }); }
  if ((m=s.match(/^add up to (\d+) cards? from the top of your deck to the top of your life cards$/))){ const n=+m[1]; return R(`أضف ${n} إلى حياتك`, async p=>{ for (let i=0;i<n;i++) addLife(p); }); }
  if ((m=s.match(/^add (\d+) cards? from the top of your life cards to your hand$/))){ return R('خذ بطاقة حياة إلى يدك', async p=>{ lifeToHand(p); }); }
  if ((m=s.match(/^add up to (\d+) (.+?) from your trash to your hand$/))){ const F=afCardFilter(m[2]); return R(`أعد ${F.ar} من مقبرتك إلى يدك`, async p=>fromTrash(p,F.fn,`أعد ${F.ar}`)); }
  if ((m=s.match(/^up to (\d+) of your opponent's characters?(.*?) cannot attack until the end of your opponent's next turn$/))){ const n=+m[1], F=afCharFilter(m[2]);
    return R(`${afUp(n,'شخصية')} للخصم لا تهاجم حتى نهاية دوره القادم`, async p=>{ const ts=await pickOpp(p,F.fn,n,'لن تستطيع الهجوم'); ts.forEach(t=>{ addMod(t,{k:'cantAttack',until:oppNext(p)}); fx(t.uid,'⛔','#fff'); }); }); }
  if ((m=s.match(/^set up to (\d+) of your (.*?)characters?(.*?) as active$/))){ const n=+m[1], F=afCharFilter(m[2]+' '+m[3]);
    return R(`اجعل ${afUp(n,'شخصية')} لك نشطة`, async p=>{ for (let i=0;i<n;i++) await setActive(p,F.fn,'اختر شخصية لتنشط'); }); }
  if (/^set this (character|leader) as active$/.test(s)) return R('تعود نشطة', async (p,c)=>{ if (c){ c.rested=false; fx(c.uid,'🔄','#7dff9b'); } });
  if ((m=s.match(/^up to (\d+) of your \[([^\]]+)\](?: cards?)? gains? \+(\d+) power(?: during this (turn|battle))?$/))){ const n=+m[1], nme=m[2], v=+m[3], battle=m[4]==='battle';
    return R(`${nme} لديك +${v} قوة ${battle?'في المعركة':'هذا الدور'}`, async p=>{ const d=defender(); const cands=[ldr(p),...P(p).chars].filter(x=>x.def.en.toLowerCase()===nme||(!!x.def.like&&DB[x.def.like].en.toLowerCase()===nme));
      const ts=await pickCards(p,cands,{title:`+${v} قوة`,max:n,ai:x=>x===d?99:power(x)}); ts.forEach(t=> battle&&G.battle ? battleBuff(t,v) : buffTurn(t,v)); }, {v: battle?v:0}); }
  if ((m=s.match(/^give up to (\d+) rested don!! cards? to your (?:\[[^\]]+\] |\{[^}]+\} type )?leader$/))){ const n=+m[1]; return R(`أرفق ${n} DON!! مستريحة بقائدك`, async p=>giveRested(p,ldr(p),n)); }
  if ((m=s.match(/^trash up to (\d+) cards? from the top of your opponent's life cards$/))){ const n=+m[1]; return R(`ارمِ ${n} من حياة الخصم`, async p=>{ const o=P(1-p); for (let i=0;i<n&&o.life.length;i++){ o.trash.push(o.life.pop()); fx(ldr(1-p).uid,'💔 -1','#ff5b5b'); } sfx('damage'); }); }
  if ((m=s.match(/^set up to (\d+) of your don!! cards as active at the end of this turn$/))){ const n=+m[1]; return R(`اجعل ${n} DON!! نشطة (نهاية الدور)`, async p=>{ const pl=P(p); pl.pendingDon=(pl.pendingDon||0)+n; }); }
  if ((m=s.match(/^up to (\d+) of your opponent's rested characters?(.*?) will not become active in your opponent's next refresh phase$/))){ const n=+m[1], F=afCharFilter(m[2]);
    return R(`${afUp(n,'شخصية مستريحة')} للخصم لن تنشط في دوره القادم`, async p=>{ const ts=await pickOpp(p,x=>x.rested&&F.fn(x),n,'لن تنشط'); ts.forEach(t=>{ addMod(t,{k:'noRefresh',until:G.turnPlayer===p?G.turnCount+1:G.turnCount+2}); fx(t.uid,'🔒','#fff'); }); }); }
  if ((m=s.match(/^place (\d+) cards? from your hand at the (?:top or )?bottom of your deck(?: in any order)?$/))){ const n=+m[1]; return R(`ضع ${n} من يدك أسفل مجموعتك`, async p=>{ const pl=P(p); const ts=await pickCards(p,pl.hand,{title:'أسفل المجموعة',min:Math.min(n,pl.hand.length),max:n,ai:c=>-cardValue(c)}); ts.forEach(c=>{ pl.hand.splice(pl.hand.indexOf(c),1); pl.deck.unshift(c); }); }); }
  if ((m=s.match(/^add up to (\d+) cards? from your hand to the top of your life cards$/))){ const n=+m[1]; return R(`أضف ${n} من يدك إلى حياتك`, async p=>{ const pl=P(p); const ts=await pickCards(p,pl.hand,{title:'إلى الحياة',max:n,ai:c=>-cardValue(c)}); ts.forEach(c=>{ pl.hand.splice(pl.hand.indexOf(c),1); pl.life.push(c); }); }); }
  if (/^add this card to your hand$/.test(s)) return R('أعد هذه البطاقة إلى يدك', async (p,c)=>{ const pl=P(p); const i=pl.trash.indexOf(c); if (i>=0){ pl.trash.splice(i,1); pl.hand.push(c); } });
  if ((m=s.match(/^draw (\d+) cards? and trash (\d+) cards? from your hand$/))){ const a=+m[1], b=+m[2]; return R(`اسحب ${a} ثم ارمِ ${b}`, async p=>{ draw(p,a); await trashOwn(p,b); }); }
  if ((m=s.match(/^rest up to (\d+) of your opponent's (?:characters? )?or don!! cards?$/))) return null;
  return null;
}

// يقسم النص إلى جمل أفعال
function afClauses(body){
  return body.replace(/\.\s*then,\s*/gi,'. ').replace(/,\s*then,?\s*/gi,'. ').split(/\.\s+(?=[a-z\[{])|\.\s*$|\s+and\s+(?=(?:draw|trash|ko|give|rest|add|play|set|return|place|look|up to)\b)(?!\w+\s+(?:it|them)\b)(?!add (?:it|them))/i)
    .map(x=>x.trim().replace(/^then,?\s*/i,'')).filter(Boolean);
}

/* ---------- التكاليف ---------- */
function afCost(s){
  const l=s.toLowerCase().trim(); const parts=[]; let m;
  const rest=l.match(/\{rest (\d+)\}/); if (rest) parts.push({ar:`أرح ${rest[1]} DON!!`, can:p=>P(p).donActive>=+rest[1], pay:async p=>payRestDon(p,+rest[1]), ai:()=>true});
  const dm=l.match(/don!! -(\d+)/); if (dm) parts.push({ar:`DON!! −${dm[1]}`, can:p=>donTotal(p)>=+dm[1], pay:async p=>payDonMinus(p,+dm[1]), ai:p=>donTotal(p)>=+dm[1]+3});
  const rem=l.replace(/\{rest \d+\}/,'').replace(/don!! -\d+/,'').replace(/^[\s:]+|[\s:]+$/g,'').replace(/^you may /,'');
  if (rem){
    let c=null;
    if ((m=rem.match(/^trash (\d+) (.*?)cards? from your hand$/)) && !/ and /.test(rem) || (m=rem.match(/^trash (\d+) (.*?)card with a \[trigger\] from your hand$/))){ const n=+m[1], F=afCardFilter(m[2]||''); const trig=/trigger/.test(rem);
      const flt=x=>(trig?!!FX_(x).trigger:true)&&(m[2]&&m[2].trim()&&!trig?F.fn(x):true);
      c={ar:`ارمِ ${n} ${m[2]&&m[2].trim()?F.ar:'بطاقة'} من يدك`, can:p=>P(p).hand.filter(flt).length>=n, pay:async p=>payTrash(p,n,flt), ai:p=>P(p).hand.length>=n+3}; }
    else if (/^rest this (character|stage|leader)$/.test(rem)) c={ar:'أرح هذه البطاقة', can:(p,x)=>!!x&&!x.rested, pay:async(p,x)=>{ x.rested=true; }, ai:(p,x)=>!atkMode(x)};
    else if ((m=rem.match(/^rest (\d+) of your don!! cards$/))) c={ar:`أرح ${m[1]} DON!!`, can:p=>P(p).donActive>=+m[1], pay:async p=>payRestDon(p,+m[1]), ai:()=>true};
    else if (/^trash this character$/.test(rem)) c={ar:'ارمِ هذه الشخصية', can:(p,x)=>!!x&&isOnField(x), pay:async(p,x)=>trashFromField(x), ai:p=>P(p).life.length<=2};
    else if (/^add 1 card from the top of your life cards to your hand$/.test(rem)) c={ar:'خذ بطاقة حياة إلى يدك', can:p=>P(p).life.length>0, pay:async p=>lifeToHand(p), ai:p=>P(p).life.length>=3};
    else if ((m=rem.match(/^rest this character and (\d+) of your don!! cards$/)) || (m=rem.match(/^rest (\d+) of your don!! cards and this character$/))) c={ar:`أرحها و${m[1]} DON!!`, can:(p,x)=>!!x&&!x.rested&&P(p).donActive>=+m[1], pay:async(p,x)=>{ x.rested=true; payRestDon(p,+m[1]); }, ai:(p,x)=>!atkMode(x)};
    else if ((m=rem.match(/^trash (\d+) cards? from your hand and rest this (stage|character)$/))){ const n=+m[1]; c={ar:`ارمِ ${n} وأرح هذه البطاقة`, can:(p,x)=>!!x&&!x.rested&&P(p).hand.length>=n, pay:async(p,x)=>{ if (!await payTrash(p,n)) return false; x.rested=true; }, ai:p=>P(p).hand.length>=n+3}; }
    else if ((m=rem.match(/^trash (\d+) cards? from the top of your deck$/))){ const n=+m[1]; c={ar:`ارمِ أعلى ${n} من مجموعتك`, can:p=>P(p).deck.length>n+5, pay:async p=>{ const pl=P(p); for (let i=0;i<n;i++) pl.trash.push(pl.deck.pop()); }, ai:p=>P(p).deck.length>15}; }
    else if ((m=rem.match(/^trash (\d+) cards? from the top of your life cards$/))){ const n=+m[1]; c={ar:`ارمِ ${n} من حياتك`, can:p=>P(p).life.length>=n, pay:async p=>{ const pl=P(p); for (let i=0;i<n;i++) pl.trash.push(pl.life.pop()); }, ai:p=>P(p).life.length>=4}; }
    else if ((m=rem.match(/^add (\d+) cards? from the top or bottom of your life cards to your hand$/)) || (m=rem.match(/^add (\d+) cards? from the top of your life cards to your hand$/))) c={ar:'خذ بطاقة حياة إلى يدك', can:p=>P(p).life.length>0, pay:async p=>lifeToHand(p), ai:p=>P(p).life.length>=3};
    else if ((m=rem.match(/^place (\d+) cards?(?: with a type including "[^"]+"| of \{[^}]+\} type)? from your trash at the bottom of your deck(?: in any order)?$/))){ const n=+m[1]; c={ar:`ضع ${n} من مقبرتك أسفل مجموعتك`, can:p=>P(p).trash.length>=n, pay:async p=>{ const pl=P(p); pl.deck.unshift(...pl.trash.splice(0,n)); }, ai:()=>true}; }
    if (!c) return null;
    parts.push(c);
  }
  if (!parts.length) return null;
  return {ar:parts.map(x=>x.ar).join(' و'), can:(p,x)=>parts.every(q=>q.can(p,x)), pay:async(p,x)=>{ for (const q of parts){ if ((await q.pay(p,x))===false) return false; } return true; }, ai:(p,x)=>parts.every(q=>q.ai(p,x))};
}

/* ---------- تحليل كتلة قدرة واحدة ---------- */
function afParseBody(body){
  let text=body.trim(), cost=null, cond=null, unparsed=[];
  // التكلفة قبل النقطتين
  const ci=text.indexOf(':');
  if (ci>0){ const pre=text.slice(0,ci); if (/you may|don!! -|\{rest/i.test(pre)){ cost=afCost(pre); if (!cost) return null; text=text.slice(ci+1).trim(); } }
  else if (/^\{rest \d+\}/i.test(text)){ /* تكلفة بلا نقطتين */ }
  // الشرط في البداية
  let m=text.match(/^if (.+?), (.+)$/i);
  if (m){ cond=afCond(m[1]); if (!cond){ return null; } text=m[2]; }
  const actions=[];
  for (const cl of afClauses(text)){
    AF_STATS.clauses++;
    // شرط في نهاية الجملة: "draw 1 card if you have ..."
    let tail=null, c2=cl; const tm=cl.match(/^(.*?) if (you have|your opponent has|your leader)(.+)$/i);
    if (tm){ const cc=afCond(tm[2]+tm[3]); if (cc){ tail=cc; c2=tm[1]; } }
    const a=afAction(c2);
    if (a){ AF_STATS.parsed++; if (tail){ const r=a.run; a.run=async(p,c)=>{ if (tail.fn(p,c)) await r(p,c); }; a.ar+=` (إذا ${tail.ar})`; } actions.push(a); }
    else unparsed.push(cl);
  }
  // "trash the rest" يعدّل فعل الكشف السابق
  actions.forEach((a,i)=>{ if (a.trashRest && actions[i-1]) actions[i-1].restTo='trash'; });
  return {cost, cond, actions:actions.filter(a=>!a.noop&&!a.trashRest), unparsed};
}

/* ---------- بناء كائن التأثير لبطاقة ---------- */
function afBuild(def, text, trig){
  const fxo={auto:true}; const arParts=[]; const orig=[]; let ok=0, bad=0;
  const kw=[];
  const blocks=afBlocks(afNorm(text));
  if (trig) blocks.push({tags:['trigger'], body:afNorm(trig).replace(/^\[trigger\]\s*/i,'')});
  let idx=0;
  for (const b of blocks){
    idx++;
    const tags=b.tags; let don=0, once=false, yourTurn=false, oppTurn=false; const tims=[];
    for (const t of tags){
      if (AF_KW[t] && !b.body.trim()) { kw.push(AF_KW[t]); continue; }
      if (AF_KW[t]) { kw.push(AF_KW[t]); continue; }
      let m=t.match(/^don!! x(\d+)$/); if (m){ don=+m[1]; continue; }
      if (t==='once per turn') once=true; else if (t==='your turn') yourTurn=true; else if (t==="opponent's turn") oppTurn=true;
      else if (AF_TIMINGS[t]) tims.push(AF_TIMINGS[t]);
    }
    let body=b.body.trim().replace(/^[:\s]+/,'');
    if (!body) continue;
    if (/^also treat this card's name as/i.test(body)) { orig.push(body); continue; }
    if (/^under the rules of this game, you may have any number/i.test(body)) { def.unlimited=true; orig.push(body); continue; }
    const pre=(don?`[DON!! ×${don}] `:'')+(yourTurn?'[دورك] ':'')+(oppTurn?'[دور الخصم] ':'')+(once?'(مرة كل دور) ':'');
    // قدرات مستمرة
    if (!tims.length){
      const r=afStatic(body, {don, yourTurn, oppTurn}, fxo);
      if (r){ arParts.push(`<span class="tagx">مستمر</span>${pre}${r}`); ok++; } else { orig.push(body); bad++; AF_MISS.push(['static',body]); }
      continue;
    }
    const parsed=afParseBody(body);
    if (!parsed || !parsed.actions.length){ orig.push(body); bad++; AF_MISS.push(['block',body]); continue; }
    if (parsed.unparsed.length){ orig.push(parsed.unparsed.join('. ')); bad++; parsed.unparsed.forEach(u=>AF_MISS.push(['clause',u])); }
    ok++;
    const {cost, cond, actions}=parsed;
    const desc=(cost?`${cost.ar}: `:'')+(cond?`إذا ${cond.ar}، `:'')+actions.map(a=>a.ar).filter(Boolean).join('، ثم ');
    const run=async(p,c)=>{
      if (cond && !cond.fn(p,c)) return;
      if (cost){ const optional=true; if (!cost.can(p,c)) return;
        if (P(p).isAI){ if (!cost.ai(p,c)) return; } else if (optional && !await ask(p, `${nm(c)}: ${cost.ar} لتفعيل القدرة؟`)) return;
        if ((await cost.pay(p,c))===false) return; }
      for (const a of actions){ if (G.over) return; await a.run(p,c); render(); }
    };
    const can=(p,c)=>(!cost||cost.can(p,c)) && (!cond||cond.fn(p,c));
    for (const tm of tims){
      arParts.push(`<span class="tagx${tm==='trigger'?' trg':''}">${AF_TIM_AR[tm]}</span>${pre}${desc}`);
      const key='af'+idx;
      if (tm==='onPlay') fxo.onPlay={yourTurn, run};
      else if (tm==='whenAtk') fxo.whenAtk={don, key:once?key:undefined, run};
      else if (tm==='onBlock') fxo.onBlock={don, run};
      else if (tm==='onKO') fxo.onKO=run;
      else if (tm==='endTurn') fxo.endTurn=async(p,c)=>{ if (!don||c.don>=don) await run(p,c); };
      else if (tm==='act') fxo.act={multi:!once, can:(p,c)=>(!don||c.don>=don)&&can(p,c), ai:(p,c)=>!cost||cost.ai(p,c), run};
      else if (tm==='oppAtk') fxo.oppAtk={key:once?key:'oa'+idx, can:(p,c)=>(!don||c.don>=don)&&can(p,c), ai:p=>{ const v=actions.reduce((s,a)=>s+(a.v||0),0); return v>0&&aiNeed(p,v); }, run};
      else if (tm==='main') fxo.main={can:(p,c)=>P(p).donActive>=handCost(c)+(cost&&/أرح (\d+)/.test(cost.ar)?+cost.ar.match(/أرح (\d+)/)[1]:0) && (!cond||cond.fn(p,c)), run};
      else if (tm==='counter'){
        const v=actions.reduce((s,a)=>s+(a.v||0),0), bnc=actions.find(a=>a.bounce);
        const onlyLeader=actions.some(a=>a.leaderOnly);
        fxo.counter={v: bnc? (d=>{ const at=G.battle&&G.battle.attacker; return at&&at.def.t==='C'&&bnc.bounce.fn(at)?99000:v; }) : v,
          can:(p,c)=>(!cond||cond.fn(p,c)) && (!cost||cost.can(p,c)) && (!onlyLeader||defender()===ldr(p)), run};
      }
      else if (tm==='trigger'){
        if (actions.some(a=>a.playSelf)) fxo.trigger={play:true, cond:cond?cond.fn:null, pre:cost?async(p,c)=>{ if (!cost.can(p,c)) return false; if (!P(p).isAI && !await ask(p,`${cost.ar} لتلعب هذه البطاقة؟`)) return false; return (await cost.pay(p,c))!==false; }:null};
        else fxo.trigger={run};
      }
    }
  }
  if (kw.length) def.kw=[...new Set([...def.kw, ...kw])];
  const kwAr={blocker:'🛡 حارس',rush:'⚡ اندفاع',rc:'⚡ اندفاع ضد الشخصيات',ban:'☄ نفي',double:'⚔⚔ هجوم مزدوج',unblockable:'🚫 لا يمكن صدّه'};
  const kwLine=kw.length?[...new Set(kw)].map(k=>kwAr[k]).join(' • '):'';
  let d=arParts.join('<br>');
  if (!d && !orig.length) d='بطاقة بلا تأثير.';
  if (orig.length) d+=`${d?'<br>':''}<span class="orig">📜 <i dir="ltr">${esc(orig.join(' • '))}</i><br><small>⚠ هذا الجزء يُعرض كنص فقط ولا يُطبَّق تلقائياً.</small></span>`;
  fxo.d=d; fxo.coverage = bad ? (ok?'partial':'none') : 'full';
  return fxo;
}

// القدرات المستمرة: +قوة / كلمات مفتاحية بشروط
function afStatic(body, mod, fxo){
  const l=body.toLowerCase().replace(/\.$/,'').trim(); let m, cond=null, rest=l;
  if ((m=l.match(/^if (.+?), (.+)$/))){ cond=afCond(m[1]); if (!cond) return null; rest=m[2]; }
  const ok=c=>(!mod.don||c.don>=mod.don)&&(!mod.yourTurn||G.turnPlayer===c.owner)&&(!mod.oppTurn||G.turnPlayer!==c.owner)&&(!cond||cond.fn(c.owner,c));
  const ca=cond?`إذا ${cond.ar}، `:'';
  const parts=rest.split(/ and (?=\+|this character gains)| and this character gains /);
  const out=[];
  for (let q of parts){
    q=q.replace(/^this (character|leader) gains /,'').trim();
    if ((m=q.match(/^\+(\d+) power(?: for every (card in your hand|(\d+) events? in your trash|(\d+) cards? in your trash))?$/))){ const v=+m[1]; let mult=()=>1, ma='';
      if (m[2]==='card in your hand'){ mult=c=>P(c.owner).hand.length; ma=' لكل بطاقة في يدك'; }
      else if (m[3]){ const k=+m[3]; mult=c=>Math.floor(P(c.owner).trash.filter(x=>x.def.t==='E').length/k); ma=` لكل ${k} أحداث في المقبرة`; }
      const prev=fxo.powerS; fxo.powerS=c=>(prev?prev(c):0)+(ok(c)?v*mult(c):0); out.push(`+${v} قوة${ma}`); continue; }
    if ((m=q.match(/^\[(rush|blocker|double attack|banish|unblockable|rush: character)\]$/))){ const k=AF_KW[m[1]];
      const prev=fxo.kwS; fxo.kwS=(c,kk)=>(prev&&prev(c,kk))||(kk===k&&ok(c)); out.push(`يحصل على ${m[1]}`); continue; }
    if (/^can also attack your opponent's active characters$/.test(q) || /^this character can also attack your opponent's active characters$/.test(l)){ fxo.atkActive=c=>ok(c); out.push('يمكنها مهاجمة الشخصيات النشطة'); continue; }
    if ((m=q.match(/^\+(\d+) cost$/))){ const v=+m[1]; const prev=fxo.costS; fxo.costS=c=>(prev?prev(c):0)+(ok(c)?v:0); out.push(`+${v} تكلفة`); continue; }
    return null;
  }
  return ca+out.join(' و');
}

/* ---------- دمج كل البطاقات ---------- */
const HANDMADE = new Set();
function afIntegrate(){
  if (typeof CARDS_ALL==='undefined') return;
  Object.keys(FX).forEach(k=>HANDMADE.add(k));
  const have=new Set(Object.values(DB).map(d=>d.id));
  const tmap={LEADER:'L',CHARACTER:'C',EVENT:'E',STAGE:'S'};
  const cmap={Red:'red',Green:'green',Blue:'blue',Purple:'purple',Black:'black',Yellow:'yellow'};
  const rmap=r=>({C:'C',UC:'UC',R:'R',SR:'SR',SEC:'SEC',L:'L'}[r]||'R');
  for (const o of CARDS_ALL){
    if (have.has(o.id) || !tmap[o.t]) continue;
    const colors=(o.col||'').split('/').map(c=>cmap[c]).filter(Boolean); if (!colors.length) colors.push('black');
    const num=v=>(v===''||v==='-'||v==null)?0:(parseInt(v,10)||0);
    const set=/^[A-Z]+-?\d+/.test(o.set)?o.set:(o.id.startsWith('P-')?'P':o.id.split('-')[0]);
    const def={id:o.id, n:o.id, t:tmap[o.t], en:o.n, ar:AR_NAMES[o.n]||o.n, cost:num(o.c), life:tmap[o.t]==='L'?num(o.c):0, power:num(o.p), counter:num(o.k),
      set, types:(o.f||'').split('/').filter(Boolean), kw:[], color:colors[0], colors, attr:o.a||'', rar:rmap(o.r)};
    DB[o.id]=def;
    FX[o.id]=afBuild(def, o.x==='-'?'':o.x, o.tr&&o.tr!=='-'?o.tr:'');
    AF_STATS.cards++; AF_STATS[FX[o.id].coverage==='full'?'full':FX[o.id].coverage==='partial'?'partial':'none']++;
  }
}

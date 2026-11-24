/* Apo aventure — application (V1) */
"use strict";
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const isMobile=()=>matchMedia("(max-width:900px)").matches;
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};

/* ================= API ================= */
async function api(method,url,body){
  const r=await fetch(url,{method,headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,credentials:"same-origin"});
  let j=null;try{j=await r.json()}catch(e){}
  if(r.status===401){showGate();throw Object.assign(new Error("auth"),{status:401})}
  if(!r.ok)throw Object.assign(new Error(j&&j.error||("Erreur "+r.status)),{status:r.status,body:j});
  return j;
}

/* ================= ÉTAT ================= */
const COLLS=["personnages","relations","scenes","choix","variables","evenements","lieux","idees","intrigues"];
let DB=null;          // projet ouvert
let PATH=null;        // chemin du projet
const st={view:"accueil",chap:1,charSel:null,relChar:null,gSel:null,gMode:null,edScene:null,read:null,showLocked:true,ideaFilter:"tri",q:"",confirm:null};
const IDX={};         // index par collection : id -> objet
function reindex(){COLLS.forEach(c=>{IDX[c]={};(DB[c]||[]).forEach(o=>IDX[c][o.id]=o)})}
const list=c=>DB[c]||[];
const get=(c,id)=>IDX[c]&&IDX[c][id];

/* ================= SAUVEGARDE =================
   Chaque modification est envoyée au Mac après une courte pause.
   Hors ligne, elle reste sur l'appareil puis repart dès que le Mac répond.
   Si l'objet a changé ailleurs entre-temps, on demande quelle version garder. */
const pend={};   // clé -> {coll,id,seq,timer,force}
let inflight={}, offline=false;
const qKey=()=>"apo-q:"+PATH;
function persistQueue(){const q={};Object.values(pend).forEach(p=>{const o=get(p.coll,p.id);if(o)q[p.coll+"/"+p.id]={coll:p.coll,obj:o,force:p.force}});ls.set(qKey(),q)}
function upsert(coll,obj){
  if(!obj.id)obj.id=uid();
  if(!IDX[coll][obj.id]){DB[coll].push(obj);IDX[coll][obj.id]=obj}
  return obj;
}
function save(coll,obj,delay=700){
  upsert(coll,obj);
  const k=coll+"/"+obj.id;
  const p=pend[k]||(pend[k]={coll,id:obj.id,seq:0});
  p.seq++;clearTimeout(p.timer);
  p.timer=setTimeout(()=>flush(k),delay);
  persistQueue();setSave("busy");
  return obj;
}
async function flush(k){
  const p=pend[k];if(!p)return;
  if(inflight[k]){p.timer=setTimeout(()=>flush(k),300);return}
  const obj=get(p.coll,p.id);if(!obj){delete pend[k];persistQueue();return}
  const seq=p.seq;inflight[k]=true;
  const data={...obj};delete data._rev;delete data.id;
  try{
    const res=await api("PUT",`/api/obj?path=${encodeURIComponent(PATH)}&coll=${p.coll}&id=${encodeURIComponent(p.id)}`,{data,baseRev:obj._rev??null,force:!!p.force});
    obj._rev=res._rev;obj.modifie=res.modifie;if(!obj.cree)obj.cree=res.cree;
    p.force=false;
    if(p.seq===seq){delete pend[k]}
    offline=false;
  }catch(e){
    if(e.status===409){delete pend[k];conflict(p.coll,obj,e.body.current)}
    else if(e.status!==401){offline=true;p.timer=setTimeout(()=>flush(k),5000)}
  }finally{inflight[k]=false;persistQueue();setSave()}
}
function flushAll(){Object.keys(pend).forEach(k=>{clearTimeout(pend[k].timer);flush(k)})}
window.addEventListener("online",flushAll);
window.addEventListener("pagehide",()=>{persistQueue();flushAll()});
async function remove(coll,id){
  try{await api("DELETE",`/api/obj?path=${encodeURIComponent(PATH)}&coll=${coll}&id=${encodeURIComponent(id)}`)}
  catch(e){toast("Le Mac ne répond pas : suppression impossible pour l'instant.");return false}
  delete pend[coll+"/"+id];
  DB[coll]=DB[coll].filter(o=>o.id!==id);delete IDX[coll][id];persistQueue();return true;
}
function setSave(){
  const n=Object.keys(pend).length;
  const t=offline?"Hors ligne : gardé sur cet appareil":n?"Enregistrement…":"Tout est enregistré";
  $$(".save-dot").forEach(el=>{el.classList.toggle("busy",!!n&&!offline);el.classList.toggle("ok",!n&&!offline);el.lastChild.textContent=t});
  document.body.classList.toggle("offline",offline);
}
function conflict(coll,mine,theirs){
  const name=coll==="scenes"?`la scène « ${mine.titre} »`:"cet élément";
  openDrawer("Modifié sur un autre appareil",`<p style="margin:0">${esc(name)} a été modifiée ailleurs (sur le Mac ou l'iPhone) pendant que tu écrivais ici. Choisis la version à garder ; l'autre reste dans l'historique de la scène.</p>
   ${coll==="scenes"?`<div><div class="lbl">Ta version (cet appareil)</div><div class="diff">${esc((mine.texte||"").slice(-600))}</div></div><div><div class="lbl">L'autre version</div><div class="diff">${esc(((theirs&&theirs.texte)||"").slice(-600))}</div></div>`:""}
   <button class="btn primary" data-act="keepMine" data-coll="${coll}" data-id="${mine.id}">Garder ma version</button>
   <button class="btn" data-act="takeTheirs" data-coll="${coll}" data-id="${mine.id}">Prendre l'autre version</button>`);
  CONFLICTS[coll+"/"+mine.id]=theirs;
}
const CONFLICTS={};

/* ================= DÉMARRAGE ================= */
async function boot(){
  let s;try{s=await api("GET","/api/state")}catch(e){$("#root").innerHTML=`<div class="gate"><div class="panel"><h1>Le Mac ne répond pas</h1><p class="muted">Vérifie que le Mac est allumé, ouvert ou en veille réseau, et sur le même Wi-Fi.</p><button class="btn primary" onclick="location.reload()">Réessayer</button></div></div>`;return}
  if(s.needSetup)return showSetup();
  if(!s.logged)return showGate();
  const last=ls.get("apo-last",null);
  if(last){try{await openProject(last);return}catch(e){}}
  showProjects();
}
function showSetup(){
  $("#root").innerHTML=`<div class="gate"><form class="panel" id="f"><div class="brand"><div class="brand-mark">A</div><b>Apo aventure</b></div><h1>Bienvenue</h1><p class="muted" style="margin:0">Choisis un code d'accès. Il protège ton roman des autres appareils du Wi-Fi. Tu le taperas une seule fois par appareil.</p><div class="field"><label for="c1">Code d'accès (4 caractères minimum)</label><input id="c1" type="password" autocomplete="new-password" required></div><div class="field"><label for="c2">Le même, pour vérifier</label><input id="c2" type="password" autocomplete="new-password" required></div><div class="err" id="er"></div><button class="btn primary">Commencer</button></form></div>`;
  $("#f").onsubmit=async e=>{e.preventDefault();const a=$("#c1").value,b=$("#c2").value;if(a!==b){$("#er").textContent="Les deux codes sont différents.";return}try{await api("POST","/api/setup",{code:a});showProjects()}catch(x){$("#er").textContent=x.message}};
}
function showGate(){
  $("#root").innerHTML=`<div class="gate"><form class="panel" id="f"><div class="brand"><div class="brand-mark">A</div><b>Apo aventure</b></div><h1>Code d'accès</h1><div class="field"><label for="c1">Ton code</label><input id="c1" type="password" autocomplete="current-password" inputmode="text" required autofocus></div><div class="err" id="er"></div><button class="btn primary">Ouvrir</button></form></div>`;
  $("#f").onsubmit=async e=>{e.preventDefault();try{await api("POST","/api/login",{code:$("#c1").value});boot()}catch(x){$("#er").textContent=x.message}};
}

/* ================= PROJETS ================= */
async function showProjects(){
  DB=null;PATH=null;ls.del("apo-last");
  const tree=await api("GET","/api/projects");
  const card=p=>`<button class="panel pcard" data-open="${esc(p.path)}"><div class="brand-mark" style="width:38px;height:38px">${esc((p.titre[0]||"?").toUpperCase())}</div><div style="flex:1;min-width:0"><b>${esc(p.titre)}</b><div class="note">${esc(p.genre||"Roman")} · modifié ${fmtDate(p.modif)}</div></div><span class="muted">→</span></button>`;
  $("#root").innerHTML=`<div class="projects">
    <div class="brand"><div class="brand-mark">A</div><b>Apo aventure</b><span style="flex:1"></span><button class="btn sm ghost" data-act="settingsGlobal">Réglages</button></div>
    <h1>Mes romans</h1>
    ${tree.length?tree.map(n=>n.type==="saga"?`<div class="panel saga"><div class="saga-h"><span class="chip ink">saga</span><b>${esc(n.titre)}</b><button class="btn sm" data-act="newProj" data-parent="${esc(n.path)}">+ Tome</button></div>${(n.children||[]).filter(c=>c.type==="roman").map(card).join("")||'<p class="note" style="margin:0">Aucun tome pour l\'instant.</p>'}</div>`:card(n)).join(""):`<div class="panel empty">Aucun roman pour l'instant. Crée ton premier roman ou une saga, ou ouvre l'exemple pour explorer l'outil.</div>`}
    <div class="chips"><button class="btn primary" data-act="newProj">+ Roman</button><button class="btn" data-act="newSaga">+ Saga</button><button class="btn ghost" data-act="seedDemo">Créer le roman d'exemple</button></div>
    <p class="note">Sur le Mac, chaque saga est un dossier et chaque tome un sous-dossier, dans « Documents / Apo aventure ».</p>
  </div>`;
}
function fmtDate(ms){if(!ms)return"";const d=new Date(ms),now=new Date();const diff=(now-d)/1000;if(diff<60)return"à l'instant";if(diff<3600)return`il y a ${Math.round(diff/60)} min`;if(d.toDateString()===now.toDateString())return"aujourd'hui à "+d.toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit"});return"le "+d.toLocaleDateString("fr-FR",{day:"numeric",month:"long"})}
function newProjForm(parent,saga){
  openDrawer(saga?"Nouvelle saga":parent?"Nouveau tome":"Nouveau roman",`<form id="np" class="grid" style="gap:14px"><div class="field"><label for="npT">Titre</label><input id="npT" required></div>${saga?"":`<div class="field"><label for="npG">Genre</label><input id="npG" placeholder="Romance, policier…"></div><div class="field"><label for="npR">Résumé</label><textarea id="npR"></textarea></div>`}<button class="btn primary">Créer</button></form>`);
  setTimeout(()=>$("#npT").focus(),200);
  $("#np").onsubmit=async e=>{e.preventDefault();const r=await api("POST","/api/projects",{titre:$("#npT").value,type:saga?"saga":"roman",parent:parent||"",genre:$("#npG")?.value||"",resume:$("#npR")?.value||""});closeDrawer();if(saga)showProjects();else openProject(r.path)};
}
async function openProject(path){
  const data=await api("GET","/api/project?path="+encodeURIComponent(path));
  DB=data;PATH=path;COLLS.forEach(c=>DB[c]=DB[c]||[]);reindex();
  ls.set("apo-last",path);
  // modifications restées sur l'appareil (hors ligne)
  const q=ls.get(qKey(),{});
  Object.values(q).forEach(({coll,obj,force})=>{const cur=get(coll,obj.id);if(cur)Object.assign(cur,obj);else upsert(coll,obj);const k=coll+"/"+obj.id;pend[k]={coll,id:obj.id,seq:1,force};pend[k].timer=setTimeout(()=>flush(k),200)});
  const v=ls.get("apo-view:"+path,{});
  st.view=v.view||"accueil";st.edScene=v.edScene||null;st.read=null;st.charSel=null;st.gSel=null;
  st.chap=Math.min(st.chap,nChap());
  shell();go(location.hash.slice(1)||st.view,false);
}
async function refresh(){
  if(!PATH||Object.keys(pend).length)return;
  const ae=document.activeElement;if(ae&&(ae.tagName==="TEXTAREA"||ae.tagName==="INPUT"))return;
  try{const data=await api("GET","/api/project?path="+encodeURIComponent(PATH));
    const sig=d=>COLLS.map(c=>(d[c]||[]).map(o=>o.id+o._rev).sort().join()).join("|")+JSON.stringify(d.projet);
    if(sig(data)!==sig(DB)){DB=data;COLLS.forEach(c=>DB[c]=DB[c]||[]);reindex();render()}
    offline=false;setSave();
  }catch(e){if(e.status!==401){offline=true;setSave()}}
}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"){flushAll();refresh()}});

/* ================= COQUILLE ================= */
const ICON={
 accueil:'<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
 personnages:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.6c2.6.2 4.4 2 5 5"/>',
 relations:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 chronologie:'<path d="M3 12h18"/><circle cx="7" cy="12" r="2"/><circle cx="14" cy="12" r="2"/><path d="M7 5v3M14 16v3M19 5v3"/>',
 graphe:'<circle cx="5" cy="12" r="2.2"/><circle cx="18" cy="5.5" r="2.2"/><circle cx="18" cy="18.5" r="2.2"/><path d="M7 11l9-4.5M7 13l9 4.5"/>',
 matrice:'<path d="M3 5h18M3 12h18M3 19h18M9 3v18"/>',
 scene:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
 lecture:'<path d="M3 5.5C6 4 9 4 12 6c3-2 6-2 9-.5V19c-3-1.5-6-1.5-9 .5-3-2-6-2-9-.5z"/><path d="M12 6v13.5"/>',
 idees:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
 lieux:'<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
 recherche:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
 reglages:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
 plus:'<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
};
const VIEWS={
 accueil:{t:"Accueil du projet",g:"Projet"},
 scene:{t:"Écrire",g:"Projet"},
 graphe:{t:"Graphe des choix",g:"Histoire"},
 matrice:{t:"Matrice des choix",g:"Histoire"},
 lecture:{t:"Mode lecture",g:"Histoire"},
 personnages:{t:"Personnages",g:"Univers"},
 relations:{t:"Relations",g:"Univers"},
 chronologie:{t:"Chronologie",g:"Univers"},
 lieux:{t:"Lieux",g:"Univers"},
 idees:{t:"Boîte à idées",g:"Univers"},
 recherche:{t:"Recherche",g:null},
 reglages:{t:"Réglages",g:null},
};
function shell(){
  $("#root").innerHTML=`<div class="app">
  <aside class="side" aria-label="Navigation">
    <div class="brand"><div class="brand-mark">A</div><b>Apo aventure</b></div>
    <button class="proj" data-act="projects"><small id="pSaga"></small><span id="pTitle"></span></button>
    <nav class="nav" id="nav"></nav>
    <div class="side-foot">
      <button class="btn sm ghost" data-go="reglages" style="justify-content:flex-start"><svg viewBox="0 0 24 24">${ICON.reglages}</svg>Réglages et accès iPhone</button>
      <button class="btn sm ghost danger" data-go="reglages" data-stop="1" style="justify-content:flex-start"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Arrêter l'appli</button>
      <div class="seg" id="themeSeg"><button data-theme-set="light">Clair</button><button data-theme-set="dark">Sombre</button></div>
      <div class="seg"><button data-act="txt-" aria-label="Texte plus petit">A−</button><button data-act="txt+" aria-label="Texte plus grand">A+</button></div>
    </div>
  </aside>
  <div class="main">
    <header class="top">
      <div class="top-title"><span class="crumb" id="crumb"></span><h1 id="title"></h1></div>
      <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" type="search" placeholder="Rechercher (⌘K)" autocomplete="off"></label>
      <button class="x m-search" data-go="recherche" aria-label="Rechercher"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>
      <span class="save-dot hide-m"><i></i>Tout est enregistré</span>
    </header>
    <section class="view" id="view"></section>
  </div>
  </div>
  <nav class="tabbar" id="tabbar" aria-label="Onglets"></nav>
  <span class="save-dot m ok"><i></i>Tout est enregistré</span>
  <button class="fab" data-act="idea" aria-label="Nouvelle idée"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Idée</span></button>`;
  $("#q").addEventListener("input",e=>{st.q=e.target.value;if(st.view!=="recherche")go("recherche");else $("#results").innerHTML=results(st.q)});
  setSave();
}
function renderNav(){
  let h="",g="";
  for(const [k,v] of Object.entries(VIEWS)){if(!v.g)continue;
    if(v.g!==g){g=v.g;h+=`<div class="nav-label">${g}</div>`}
    h+=`<button data-go="${k}" ${st.view===k?'aria-current="page"':""}><svg viewBox="0 0 24 24">${ICON[k]}</svg>${v.t}</button>`}
  $("#nav").innerHTML=h;
  const tabs=[["accueil","Accueil"],["scene","Écrire"],["graphe","Choix"],["relations","Relations"]];
  $("#tabbar").innerHTML=tabs.map(([k,l])=>`<button data-go="${k}" ${st.view===k?'aria-current="page"':""}><svg viewBox="0 0 24 24">${ICON[k]}</svg>${l}</button>`).join("")+`<button data-act="more" ${!tabs.some(t=>t[0]===st.view)?'aria-current="page"':""}><svg viewBox="0 0 24 24">${ICON.plus}</svg>Plus</button>`;
  $$("[data-theme-set]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.themeSet===(document.documentElement.dataset.theme||"light")));
  const parts=PATH.split("/");$("#pSaga").textContent=parts.length>1?parts.slice(0,-1).join(" / "):"Roman";$("#pTitle").textContent=DB.projet.titre||parts.at(-1);
}
function go(v,push=true){
  if(!VIEWS[v])v="accueil";
  st.view=v;ls.set("apo-view:"+PATH,{view:v,edScene:st.edScene});
  if(push&&location.hash!=="#"+v){try{history.replaceState(null,"","#"+v)}catch(e){}}
  closeDrawer();render();window.scrollTo(0,0);
}
function render(){
  if(!DB)return;
  renderNav();
  const v=VIEWS[st.view];
  $("#title").textContent=st.view==="personnages"&&st.charSel&&get("personnages",st.charSel)?get("personnages",st.charSel).nom:v.t;
  $("#crumb").textContent=DB.projet.titre||"";
  $("#view").innerHTML=R_[st.view]();
  after[st.view]&&after[st.view]();
  setSave();
}

/* ================= OUTILS D'AFFICHAGE ================= */
const PALETTE=["#7A5CC2","#C2185B","#D9703A","#B98A1F","#22908A","#3B68B0","#647834","#8A3FA8","#A92A21","#5C6176"];
const RT={amour:"Amour",attirance:"Attirance",amitie:"Amitié",famille:"Famille",rivalite:"Rivalité",haine:"Haine",mefiance:"Méfiance",dette:"Dette",secret:"Secret partagé"};
const STATUTS={idee:"idée",plan:"plan",brouillon:"brouillon",relu:"relu",final:"final"};
const nChap=()=>Math.max(1,+DB.projet.chapitres||1);
const chars=()=>list("personnages").slice().sort((a,b)=>(a.ordre??0)-(b.ordre??0)||String(a.nom).localeCompare(b.nom));
const cname=id=>{const c=get("personnages",id);return c?c.nom:"?"};
const short=id=>cname(id).split(" ")[0];
const ini=n=>String(n||"?").split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase();
const av=(id,cls="")=>{const c=get("personnages",id);return `<span class="av ${cls}" style="background:${c?c.couleur||"#5C6176":"#5C6176"}">${esc(ini(c?c.nom:"?"))}</span>`};
const stat=s=>`<span class="status st-${s||"idee"}">${STATUTS[s]||"idée"}</span>`;
const rtag=t=>`<span class="rt" style="color:var(--r-${t})"><i style="background:var(--r-${t})"></i>${RT[t]||t}</span>`;
const pips=(n,t)=>`<span class="pips" aria-label="intensité ${n} sur 5">${[1,2,3,4,5].map(i=>`<span style="${i<=n?`background:var(--r-${t})`:""}"></span>`).join("")}</span>`;
const lieuNom=id=>{const l=get("lieux",id);return l?l.nom:(id||"")};
const words=t=>(String(t||"").trim().match(/\S+/g)||[]).length;
const sceneT=id=>{const s=get("scenes",id);return s?s.titre||"Sans titre":"(scène supprimée)"};
const scenesSorted=()=>list("scenes").slice().sort((a,b)=>(+a.chap||1)-(+b.chap||1)||String(a.titre).localeCompare(b.titre));
const vars=()=>list("variables").slice().sort((a,b)=>(a.type===b.type?0:a.type==="jauge"?-1:1)||String(a.nom).localeCompare(b.nom));
const vname=id=>{const v=get("variables",id);return v?v.nom:"(variable supprimée)"};

/* ================= LOGIQUE DES CHOIX ================= */
const out=id=>list("choix").filter(c=>c.de===id).sort((a,b)=>(a.ordre??0)-(b.ordre??0));
const inc=id=>list("choix").filter(c=>c.vers===id);
const OPS={">=":"≥","<=":"≤","=":"=",">":">","<":"<"};
const condTxt=c=>(c||[]).map(([v,op,val])=>{const V=get("variables",v);if(!V)return"?";return V.type==="drapeau"?(val?V.nom:"pas « "+V.nom+" »"):`${V.nom} ${OPS[op]||op} ${val}`}).join(" et ");
const effHtml=e=>(e||[]).map(([v,x])=>{const V=get("variables",v);if(!V)return"";return V.type==="drapeau"?`<span class="eff f">⚑ ${x?"":"retire "}${esc(V.nom)}</span>`:`<span class="eff ${x>0?"p":"n"}">${esc(V.nom)} ${x>0?"+":""}${x}</span>`}).join(" ");
function okCond(c,vs){return(c||[]).every(([v,op,val])=>{const x=vs[v];switch(op){case">=":return x>=val;case"<=":return x<=val;case">":return x>val;case"<":return x<val;default:return x===val}})}
const startScene=()=>{const d=DB.projet.depart;if(d&&get("scenes",d))return d;const s=scenesSorted()[0];return s&&s.id};
function checks(){
  const start=startScene(),reach=new Set(),q=start?[start]:[];if(start)reach.add(start);
  while(q.length){const n=q.shift();out(n).forEach(c=>{if(get("scenes",c.vers)&&!reach.has(c.vers)){reach.add(c.vers);q.push(c.vers)}})}
  const ids=list("scenes").map(s=>s.id);
  const conf=[];
  const evs=list("evenements");
  for(let i=0;i<evs.length;i++)for(let j=i+1;j<evs.length;j++){const a=evs[i],b=evs[j];
    if(!a.quand||String(a.quand).trim().toLowerCase()!==String(b.quand||"").trim().toLowerCase())continue;
    if(!a.lieu||!b.lieu||a.lieu===b.lieu)continue;
    if(a.branche&&b.branche&&a.branche!==b.branche)continue;
    (a.persos||[]).filter(p=>(b.persos||[]).includes(p)).forEach(p=>conf.push({p,a:a.id,b:b.id,quand:a.quand}))}
  return {
    impasses:ids.filter(id=>!get("scenes",id).fin&&out(id).length===0),
    inatteignables:ids.filter(id=>!reach.has(id)),
    cassés:list("choix").filter(c=>!get("scenes",c.vers)||!get("scenes",c.de)),
    conflits:conf,
  };
}

/* ================= VUES ================= */
const R_={},after={};

/* --- accueil --- */
R_.accueil=()=>{
  const k=checks(),sc=list("scenes"),wc=sc.reduce((a,s)=>a+words(s.texte),0),ends=sc.filter(s=>s.fin).length;
  const last=sc.slice().sort((a,b)=>String(b.modifie||"").localeCompare(String(a.modifie||"")))[0];
  const alerts=[
    ...k.impasses.map(id=>({c:"var(--warn)",t:`Impasse : « ${esc(sceneT(id))} » n'a aucun choix sortant et n'est pas une fin.`,a:`data-gsel="${id}"`})),
    ...k.inatteignables.map(id=>({c:"var(--warn)",t:`Jamais atteinte : aucun chemin depuis le début ne mène à « ${esc(sceneT(id))} ».`,a:`data-gsel="${id}"`})),
    ...k.cassés.map(c=>({c:"var(--bad)",t:`Le choix « ${esc(c.texte)} » mène à une scène supprimée.`,a:`data-act="editChoice" data-id="${c.id}"`})),
    ...k.conflits.map(x=>({c:"var(--bad)",t:`Chronologie : ${esc(cname(x.p))} est à deux endroits (${esc(x.quand)}).`,a:'data-go="chronologie"'})),
  ];
  const ideas=list("idees").filter(i=>i.tri!==false);
  return `<div class="grid g-home">
    <div class="grid">
      ${last?`<div class="panel resume"><div style="flex:1;min-width:0"><div class="lbl" style="color:var(--accent)">Reprendre là où tu t'es arrêté</div><h3>${esc(last.titre)}</h3><p>Chapitre ${last.chap||1} · ${stat(last.statut)} · ${words(last.texte)} mots · ${fmtDate(Date.parse(last.modifie))}</p></div><button class="btn primary" data-scene="${last.id}"><svg viewBox="0 0 24 24">${ICON.scene}</svg>Continuer d'écrire</button></div>`
      :`<div class="panel resume"><div style="flex:1;min-width:0"><h3>Ton roman est vide</h3><p>Commence par la première scène. Tu ajouteras les choix du lecteur ensuite, depuis l'éditeur ou le graphe.</p></div><button class="btn primary" data-act="newScene">+ Première scène</button></div>`}
      <div class="stats">
        <div class="panel stat"><b class="tnum">${sc.length}</b><span>scènes</span></div>
        <div class="panel stat"><b class="tnum">${wc.toLocaleString("fr-FR")}</b><span>mots écrits</span></div>
        <div class="panel stat"><b class="tnum">${ends}</b><span>fins</span></div>
        <div class="panel stat"><b class="tnum">${list("choix").length}</b><span>choix du lecteur</span></div>
      </div>
      <div class="panel"><div class="panel-h"><h2>À vérifier</h2><span class="chip ${alerts.length?"warn":"good"}">${alerts.length||"rien"}</span></div>
        <div class="panel-b">${alerts.map(a=>`<div class="alert"><span class="dot" style="background:${a.c}"></span><p>${a.t}</p><button class="btn sm" ${a.a}>Voir</button></div>`).join("")||'<p class="note" style="margin:0">Aucune impasse, aucune scène oubliée, aucune incohérence de chronologie.</p>'}</div></div>
      <div class="panel"><div class="panel-h"><h2>Avancement par chapitre</h2><button class="btn sm ghost" style="margin-left:auto" data-act="editProj">Modifier le projet</button></div>
        <div class="panel-b list">${Array.from({length:nChap()},(_,i)=>i+1).map(n=>{const ss=scenesSorted().filter(x=>(+x.chap||1)===n);return `<div class="row"><b style="width:96px;flex:none">Chapitre ${n}</b><div class="grow"><div class="chips">${ss.map(x=>`<button class="chip" data-scene="${x.id}">${stat(x.statut)} ${esc(x.titre)}</button>`).join("")||'<span class="note">Aucune scène</span>'}</div></div></div>`}).join("")}</div></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="panel"><div class="panel-h"><h2>Boîte à idées</h2><span class="chip acc">${ideas.length} à trier</span><button class="btn sm ghost" style="margin-left:auto" data-go="idees">Tout voir</button></div>
        <div class="panel-b list">${ideas.slice(0,4).map(i=>`<div class="row"><div class="grow"><small style="font-family:var(--f-text);font-size:14.5px;color:var(--fg)">${esc(i.texte)}</small></div></div>`).join("")||'<p class="note" style="margin:0">Le bouton + Idée note une idée en deux gestes.</p>'}</div></div>
      <div class="panel"><div class="panel-h"><h2>Exporter</h2></div>
        <div class="panel-b grid" style="gap:10px"><p class="note" style="margin:0">Livre dont vous êtes le héros : chaque scène devient un paragraphe numéroté, chaque choix renvoie au bon numéro. Format 6 × 9 pouces pour KDP.</p>
          <div class="chips"><a class="btn sm" href="/api/export?fmt=docx&path=${encodeURIComponent(PATH)}">Word (KDP, Kindle)</a><a class="btn sm" href="/api/export?fmt=docx&notes=1&path=${encodeURIComponent(PATH)}">Word avec titres de scènes</a><a class="btn sm" href="/api/export?fmt=md&path=${encodeURIComponent(PATH)}">Markdown</a></div></div></div>
      ${accessPanel()}
    </div></div>`;
};
function accessPanel(){return `<div class="panel"><div class="panel-h"><h2>Ouvrir sur l'iPhone</h2></div><div class="panel-b access"><img class="qr" src="/api/qr.png" alt="QR code de l'adresse de l'atelier" width="96" height="96"><div style="min-width:0"><p style="margin:0 0 6px;font-size:14px">Scanne avec l'appareil photo, puis dans Safari : Partager, « Sur l'écran d'accueil ».</p><code id="appUrl">…</code><p class="note" id="appIps" style="margin:6px 0 0"></p></div></div></div>`}
function fillAccess(){api("GET","/api/info").then(i=>{const u=$("#appUrl");if(u)u.textContent=i.url;const p=$("#appIps");if(p)p.textContent=i.ips.length?"Si l'adresse ne marche pas : "+i.ips[0]:""}).catch(()=>{})}
after.accueil=fillAccess;

/* --- personnages --- */
R_.personnages=()=>{
  if(st.charSel&&get("personnages",st.charSel))return fiche(st.charSel);
  const cs=chars();
  return `<div class="toolbar"><span class="note">${cs.length} personnage${cs.length>1?"s":""}</span><span class="spacer"></span><button class="btn primary sm" data-act="newChar">+ Personnage</button></div>
  ${cs.length?`<div class="cards">${cs.map(c=>`<button class="panel ccard" data-char="${c.id}"><div class="hd">${av(c.id)}<div style="min-width:0"><h3>${esc(c.nom)}</h3><span class="muted" style="font-size:13px">${esc(c.role||"")}${c.age?" · "+esc(c.age)+" ans":""}</span></div></div><p>${esc(c.personnalite||"")}</p><div class="chips">${(c.tags||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join("")}<span class="chip ink">${list("scenes").filter(s=>(s.persos||[]).includes(c.id)).length} scènes</span></div></button>`).join("")}</div>`:'<div class="panel empty">Aucun personnage. Crée le premier : il apparaîtra aussitôt dans les relations, la chronologie et les scènes.</div>'}`;
};
const FIELDS=[["apparence","Apparence"],["personnalite","Personnalité"],["voix","Voix, tics de langage"],["passe","Passé"],["secret","Secrets"],["desir","Désirs"],["peur","Peurs"],["notes","Notes libres"]];
function fiche(id){
  const c=get("personnages",id);
  const scenes=scenesSorted().filter(s=>(s.persos||[]).includes(id));
  const evs=list("evenements").filter(e=>(e.persos||[]).includes(id));
  const rels=list("relations").filter(r=>r.a===id||r.b===id);
  const inp=(f,ph="")=>`<input class="inline-in" data-cf="${f}" value="${esc(c[f]||"")}" placeholder="${ph}">`;
  const ta=(f,ph="")=>`<textarea class="inline-in" data-cf="${f}" rows="2" placeholder="${ph}">${esc(c[f]||"")}</textarea>`;
  return `<div class="toolbar"><button class="btn sm" data-char="">← Tous les personnages</button><span class="spacer"></span>${st.confirm==="char"?`<div class="confirm"><span>Supprimer ${esc(c.nom)} ? La fiche part dans la corbeille du projet.</span><div class="chips"><button class="btn sm danger" data-act="delChar" data-id="${id}">Supprimer</button><button class="btn sm" data-act="noConfirm">Annuler</button></div></div>`:`<button class="btn sm ghost danger" data-act="askConfirm" data-what="char">Supprimer</button>`}</div>
  <div class="fiche"><div class="grid" style="align-content:start">
    <div class="panel fiche-hd">${av(id,"lg")}<div style="min-width:0;flex:1;display:grid;gap:4px">
      <input class="inline-in" data-cf="nom" value="${esc(c.nom)}" style="font-family:var(--f-display);font-size:26px;font-weight:650" aria-label="Nom">
      <div class="rowform">${inp("role","Rôle (protagoniste, love interest…)")}</div>
      <div class="rowform"><input class="inline-in" data-cf="surnom" value="${esc(c.surnom||"")}" placeholder="Surnom" style="flex:1"><input class="inline-in" data-cf="age" value="${esc(c.age||"")}" placeholder="Âge" style="width:90px"></div>
      <div class="rowform"><input class="inline-in" data-cf="tagsTxt" value="${esc((c.tags||[]).join(", "))}" placeholder="Étiquettes, séparées par des virgules"></div>
      <div class="colors">${PALETTE.map(p=>`<button style="background:${p}" aria-label="Couleur" aria-pressed="${c.couleur===p}" data-color="${p}"></button>`).join("")}</div>
    </div></div>
    <div class="panel"><div class="panel-h"><h2>Profil</h2></div><div class="panel-b"><dl class="kv">${FIELDS.map(([f,l])=>`<dt>${l}</dt><dd>${ta(f)}</dd>`).join("")}</dl></div></div>
    <div class="panel"><div class="panel-h"><h2>Arc</h2></div><div class="panel-b arc"><div><b>Départ</b>${ta("arcDepart")}</div><div><b>Transformation</b>${ta("arcTransfo")}</div><div><b>Arrivée (selon les branches)</b>${ta("arcArrivee")}</div></div></div>
  </div><div class="grid" style="align-content:start">
    <div class="panel"><div class="panel-h"><h2>Scènes</h2><span class="chip">${scenes.length}</span></div><div class="panel-b list">${scenes.map(s=>`<div class="row"><div class="grow"><b>${esc(s.titre)}</b><small>Chapitre ${s.chap||1}</small></div>${stat(s.statut)}<button class="btn sm" data-scene="${s.id}">Ouvrir</button></div>`).join("")||'<span class="note">Ajoute le personnage à une scène depuis l\'éditeur (ou tape @ dans le texte).</span>'}</div></div>
    <div class="panel"><div class="panel-h"><h2>Relations (ch. ${st.chap})</h2><button class="btn sm ghost" style="margin-left:auto" data-go="relations">Matrice</button></div><div class="panel-b list">${rels.map(r=>{const e=relAt(r);return e?`<button class="row" style="all:unset;display:flex;gap:10px;align-items:center;padding:8px 0;cursor:pointer;border-bottom:1px solid var(--line)" data-rel="${r.a}>${r.b}">${av(r.a,"sm")}<span class="muted">→</span>${av(r.b,"sm")}<div class="grow"><b>${esc(short(r.a))} → ${esc(short(r.b))}</b><small>${esc(e.note||"")}</small></div>${rtag(e.type)}</button>`:""}).join("")||'<span class="note">Aucune relation.</span>'}</div></div>
    <div class="panel"><div class="panel-h"><h2>Événements</h2></div><div class="panel-b list">${evs.map(e=>`<div class="row"><div class="grow"><b>${esc(e.titre)}</b><small>${esc(e.quand||"")} · ${esc(lieuNom(e.lieu))}</small></div><button class="btn sm" data-ev="${e.id}">Voir</button></div>`).join("")||'<span class="note">Aucun événement.</span>'}</div></div>
  </div></div>`;
}
after.personnages=()=>{
  if(!st.charSel)return;const c=get("personnages",st.charSel);if(!c)return;
  $$("[data-cf]").forEach(el=>el.addEventListener("input",()=>{const f=el.dataset.cf;if(f==="tagsTxt")c.tags=el.value.split(",").map(s=>s.trim()).filter(Boolean);else c[f]=el.value;if(f==="nom")$("#title").textContent=c.nom;save("personnages",c)}));
};
function newChar(){const used=list("personnages").map(c=>c.couleur);const c=save("personnages",{nom:"Nouveau personnage",role:"",couleur:PALETTE.find(p=>!used.includes(p))||PALETTE[0],tags:[],ordre:list("personnages").length},0);st.charSel=c.id;go("personnages");setTimeout(()=>{const i=$('[data-cf="nom"]');if(i){i.focus();i.select()}},50)}

/* --- relations --- */
function relObj(a,b){return list("relations").find(r=>r.a===a&&r.b===b)}
function relAt(r,ch=st.chap){if(!r||!r.etats)return null;const ks=Object.keys(r.etats).map(Number).filter(k=>k<=ch).sort((x,y)=>y-x);return ks.length?r.etats[ks[0]]:null}
R_.relations=()=>{
  const cs=chars();
  if(cs.length<2)return `<div class="panel empty">Il faut au moins deux personnages pour remplir la matrice.<br><br><button class="btn primary" data-act="newChar">+ Personnage</button></div>`;
  if(!st.relChar||!get("personnages",st.relChar))st.relChar=cs[0].id;
  const N=nChap();
  const chSel=`<div class="slider"><span class="lbl" style="margin:0">Moment de l'histoire</span><input type="range" min="1" max="${N}" value="${st.chap}" id="chap" aria-label="Chapitre" ${N<2?"disabled":""}><b class="tnum">Chapitre ${st.chap}</b><span class="note">Une case encadrée a changé à ce chapitre.</span></div>`;
  const desk=`<div class="mx-wrap mx-desk"><table class="mx" style="min-width:${180+cs.length*120}px"><thead><tr><th>De ↓ / vers →</th>${cs.map(b=>`<th>${esc(short(b.id))}</th>`).join("")}</tr></thead><tbody>${cs.map(a=>`<tr><th><span style="display:flex;gap:8px;align-items:center">${av(a.id,"sm")}${esc(short(a.id))}</span></th>${cs.map(b=>{
    if(a.id===b.id)return `<td class="self"></td>`;
    const r=relObj(a.id,b.id),e=relAt(r),k=a.id+">"+b.id;
    if(!e)return `<td><button data-rel="${k}" aria-label="Ajouter une relation"><span class="muted" style="font-size:18px">+</span></button></td>`;
    const changed=r.etats[st.chap]&&st.chap>1;
    return `<td><button data-rel="${k}" class="${changed?"changed":""}" title="${esc(e.note||"")}">${rtag(e.type)}${pips(e.int||1,e.type)}${r.jauge&&get("variables",r.jauge)?`<span class="gauge-tag">${esc(vname(r.jauge))}</span>`:""}</button></td>`}).join("")}</tr>`).join("")}</tbody></table></div>`;
  const mine=list("relations").filter(r=>(r.a===st.relChar||r.b===st.relChar)&&relAt(r)).sort((x,y)=>x.a===st.relChar?-1:1);
  const mob=`<div class="rel-mobile"><div class="chips">${cs.map(c=>`<button class="chip ${st.relChar===c.id?"acc":""}" data-relchar="${c.id}">${esc(short(c.id))}</button>`).join("")}</div>
    <div class="panel"><div class="panel-h">${av(st.relChar,"sm")}<h2 style="flex:1">Relations de ${esc(short(st.relChar))}</h2><button class="btn sm" data-act="newRelFor">+</button></div><div class="panel-b list">${mine.map(r=>{const e=relAt(r),other=r.a===st.relChar?r.b:r.a;return `<button class="row" style="border-left:0;border-right:0;border-top:0;background:none;width:100%;text-align:left" data-rel="${r.a}>${r.b}">${av(other,"sm")}<div class="grow"><b>${r.a===st.relChar?"→ "+esc(short(r.b)):esc(short(r.a))+" →"}</b><small>${esc(e.note||"")}</small></div><div style="display:grid;justify-items:end;gap:4px">${rtag(e.type)}${pips(e.int||1,e.type)}</div></button>`}).join("")||'<span class="note">Aucune relation à ce chapitre.</span>'}</div></div></div>`;
  return `<div class="toolbar">${chSel}</div>${desk}${mob}<div class="legend">${Object.keys(RT).map(rtag).join("")}</div>`;
};
after.relations=()=>{const s=$("#chap");s&&s.addEventListener("input",()=>{st.chap=+s.value;render()})};
function openRel(k){
  const [a,b]=k.split(">");
  const r=relObj(a,b),own=r&&r.etats&&r.etats[st.chap],e=relAt(r)||{type:"amitie",int:2,note:""};
  openDrawer(`${short(a)} → ${short(b)}`,`
    <div style="display:flex;gap:8px;align-items:center">${av(a)}<span class="muted">ce que ${esc(short(a))} ressent pour</span>${av(b)}</div>
    ${own||!r?"":`<p class="note" style="margin:0">Pas de changement saisi au chapitre ${st.chap} : la relation reprend l'état précédent. Enregistrer crée un nouvel état à partir de ce chapitre.</p>`}
    <div class="field"><label for="rt">Type (à partir du chapitre ${st.chap})</label><select id="rt">${Object.entries(RT).map(([k2,l])=>`<option value="${k2}" ${k2===e.type?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label for="ri">Intensité : <b id="riv">${e.int||2}</b> / 5</label><input id="ri" type="range" min="1" max="5" value="${e.int||2}" style="accent-color:var(--accent)"></div>
    <div class="field"><label for="rn">Note</label><textarea id="rn">${esc(e.note||"")}</textarea></div>
    <div class="field"><label for="rj">Jauge liée (facultatif)</label><select id="rj"><option value="">Aucune</option>${vars().filter(v=>v.type==="jauge").map(v=>`<option value="${v.id}" ${r&&r.jauge===v.id?"selected":""}>${esc(v.nom)}</option>`).join("")}</select></div>
    ${r&&r.etats?`<div><div class="lbl">Évolution</div><div class="list">${Object.keys(r.etats).map(Number).sort((x,y)=>x-y).map(c=>`<div class="row"><b style="width:80px">Dès ch. ${c}</b>${rtag(r.etats[c].type)}${pips(r.etats[c].int||1,r.etats[c].type)}<span class="grow note">${esc(r.etats[c].note||"")}</span></div>`).join("")}</div></div>`:""}
    <div class="note">Dans l'autre sens : ${relAt(relObj(b,a))?`${esc(short(b))} → ${esc(short(a))} est « ${RT[relAt(relObj(b,a)).type].toLowerCase()} ».`:"rien de saisi."}</div>
    <button class="btn primary" data-act="saveRel" data-k="${k}">Enregistrer</button>
    ${own?`<button class="btn ghost danger" data-act="delRelState" data-k="${k}">Retirer l'état du chapitre ${st.chap}</button>`:""}`);
  const ri=$("#ri");ri.addEventListener("input",()=>$("#riv").textContent=ri.value);
}
function pickRelTarget(){
  openDrawer("Nouvelle relation",`<div class="field"><label>De</label><div class="pick">${chars().map(c=>`<button data-act="relPickA" data-id="${c.id}" aria-pressed="${c.id===st.relChar}">${esc(c.nom)}</button>`).join("")}</div></div><div class="field"><label>Vers</label><div class="pick">${chars().filter(c=>c.id!==st.relChar).map(c=>`<button data-rel="${st.relChar}>${c.id}">${esc(c.nom)}</button>`).join("")}</div></div>`);
}

/* --- chronologie --- */
function moments(){
  const m=new Map();
  list("evenements").forEach(e=>{const k=String(e.quand||"Sans date").trim();const o=+e.ordre||0;if(!m.has(k.toLowerCase())||m.get(k.toLowerCase()).o>o)m.set(k.toLowerCase(),{k,o})});
  return [...m.values()].sort((a,b)=>a.o-b.o||a.k.localeCompare(b.k));
}
R_.chronologie=()=>{
  const evs=list("evenements"),ms=moments(),k=checks();
  const confIds=new Set(k.conflits.flatMap(c=>[c.a,c.b]));
  const tracks=chars().filter(c=>evs.some(e=>(e.persos||[]).includes(c.id)));
  const noOne=evs.filter(e=>!(e.persos||[]).length);
  const evBtn=e=>`<button class="ev ${confIds.has(e.id)?"conflict":e.branche?"branch":""}" data-ev="${e.id}">${esc(e.titre)}<small>${esc(lieuNom(e.lieu))}${e.branche?" · "+esc(e.branche):""}</small></button>`;
  const cols=`grid-template-columns:130px repeat(${Math.max(ms.length,1)},minmax(140px,1fr))`;
  const row=(label,filter)=>`<div class="tl-row" style="${cols}"><div class="tl-who">${label}</div>${ms.map(m=>`<div class="tl-cell">${evs.filter(e=>String(e.quand||"Sans date").trim().toLowerCase()===m.k.toLowerCase()&&filter(e)).map(evBtn).join("")}</div>`).join("")}</div>`;
  const desk=evs.length?`<div class="tl-wrap tl-desk"><div class="tl" style="min-width:${130+ms.length*150}px"><div class="tl-row hd" style="${cols}"><div>Piste</div>${ms.map(m=>`<div>${esc(m.k)}</div>`).join("")}</div>${tracks.map(c=>row(`${av(c.id,"sm")}${esc(short(c.id))}`,e=>(e.persos||[]).includes(c.id))).join("")}${noOne.length?row('<span class="muted">Sans personnage</span>',e=>!(e.persos||[]).length):""}</div></div>`:"";
  const mob=`<div class="tl-mobile grid" style="gap:14px">${ms.map(m=>`<div><div class="lbl">${esc(m.k)}</div><div class="grid" style="gap:8px">${evs.filter(e=>String(e.quand||"Sans date").trim().toLowerCase()===m.k.toLowerCase()).map(e=>`<button class="ev ${confIds.has(e.id)?"conflict":e.branche?"branch":""}" data-ev="${e.id}" style="width:100%">${esc(e.titre)}<small>${(e.persos||[]).map(short).map(esc).join(", ")} · ${esc(lieuNom(e.lieu))}${e.branche?" · "+esc(e.branche):""}</small></button>`).join("")}</div></div>`).join("")}</div>`;
  return `<div class="toolbar">${k.conflits.length?`<span class="chip bad">${k.conflits.length} incohérence${k.conflits.length>1?"s":""}</span><span class="note">${k.conflits.map(c=>`${esc(cname(c.p))} est à deux endroits (${esc(c.quand)})`).join(" · ")}</span>`:`<span class="note">Une piste par personnage. Les événements d'un même moment sont alignés.</span>`}<span class="spacer"></span><button class="btn primary sm" data-act="newEv">+ Événement</button></div>
  ${evs.length?desk+mob:'<div class="panel empty">Aucun événement. Ajoute les moments clés, y compris le passé des personnages (« Il y a 20 ans », « Jour 1, soir »…).</div>'}`;
};
function evForm(e){
  const isNew=!e;e=e||{titre:"",quand:"",ordre:"",persos:[],lieu:"",scene:"",branche:"",description:""};
  const ms=moments();
  openDrawer(isNew?"Nouvel événement":"Événement",`<form id="evf" class="grid" style="gap:14px">
    <div class="field"><label for="eT">Titre</label><input id="eT" value="${esc(e.titre)}" required></div>
    <div class="field"><label for="eQ">Quand (dans le temps de l'histoire)</label><input id="eQ" value="${esc(e.quand)}" list="eQl" placeholder="Jour 3, soir"><datalist id="eQl">${ms.map(m=>`<option value="${esc(m.k)}">`).join("")}</datalist></div>
    <div class="field"><label for="eO">Position sur la frise (nombre, pour l'ordre)</label><input id="eO" type="number" step="any" value="${esc(e.ordre)}" placeholder="${ms.length?Math.round(Math.max(...ms.map(m=>m.o))+1):1}"></div>
    <div class="field"><label>Personnages</label><div class="pick" id="eP">${chars().map(c=>`<button type="button" data-toggle aria-pressed="${(e.persos||[]).includes(c.id)}" data-id="${c.id}">${esc(c.nom)}</button>`).join("")||'<span class="note">Aucun personnage</span>'}</div></div>
    <div class="field"><label for="eL">Lieu</label><select id="eL"><option value="">—</option>${list("lieux").map(l=>`<option value="${l.id}" ${l.id===e.lieu?"selected":""}>${esc(l.nom)}</option>`).join("")}</select></div>
    <div class="field"><label for="eS">Scène liée</label><select id="eS"><option value="">—</option>${scenesSorted().map(s=>`<option value="${s.id}" ${s.id===e.scene?"selected":""}>Ch. ${s.chap||1} · ${esc(s.titre)}</option>`).join("")}</select></div>
    <div class="field"><label for="eB">N'existe que dans la branche (facultatif)</label><input id="eB" value="${esc(e.branche||"")}" placeholder="Branche Lina"></div>
    <div class="field"><label for="eD">Description</label><textarea id="eD">${esc(e.description||"")}</textarea></div>
    <button class="btn primary">Enregistrer</button>
    ${isNew?"":`<button type="button" class="btn ghost danger" data-act="delEv" data-id="${e.id}">Supprimer l'événement</button>`}
    ${!isNew&&e.scene&&get("scenes",e.scene)?`<button type="button" class="btn" data-scene="${e.scene}">Ouvrir la scène</button>`:""}
  </form>`);
  $("#evf").onsubmit=ev=>{ev.preventDefault();
    const o=isNew?{}:e;
    Object.assign(o,{titre:$("#eT").value,quand:$("#eQ").value.trim()||"Sans date",ordre:$("#eO").value===""?(ms.find(m=>m.k.toLowerCase()===$("#eQ").value.trim().toLowerCase())?.o??(ms.length?Math.max(...ms.map(m=>m.o))+1:1)):+$("#eO").value,
      persos:$$("#eP [aria-pressed=true]").map(b=>b.dataset.id),lieu:$("#eL").value,scene:$("#eS").value,branche:$("#eB").value.trim(),description:$("#eD").value});
    save("evenements",o,0);closeDrawer();render();toast("Événement enregistré.")};
}

/* --- lieux --- */
R_.lieux=()=>`<div class="toolbar"><span class="note">Les lieux servent aux scènes, aux événements et à la recherche.</span><span class="spacer"></span><button class="btn primary sm" data-act="newLieu">+ Lieu</button></div>
  ${list("lieux").length?`<div class="ideas">${list("lieux").slice().sort((a,b)=>String(a.nom).localeCompare(b.nom)).map(l=>`<div class="panel idea"><input class="inline-in" data-lf="nom" data-id="${l.id}" value="${esc(l.nom)}" style="font-weight:700;font-size:16px"><textarea class="inline-in" data-lf="description" data-id="${l.id}" rows="3" placeholder="Description, ambiance…">${esc(l.description||"")}</textarea><div class="chips"><span class="chip ink">${list("scenes").filter(s=>s.lieu===l.id).length} scènes</span><span class="chip">${list("evenements").filter(e=>e.lieu===l.id).length} événements</span><span style="flex:1"></span><button class="btn sm ghost danger" data-act="delLieu" data-id="${l.id}">Supprimer</button></div></div>`).join("")}</div>`:'<div class="panel empty">Aucun lieu pour l\'instant.</div>'}`;
after.lieux=()=>$$("[data-lf]").forEach(el=>el.addEventListener("input",()=>{const l=get("lieux",el.dataset.id);l[el.dataset.lf]=el.value;save("lieux",l)}));

/* --- graphe --- */
const NW=176,NH=58,GX=214,GY=92,PAD=24;
function layout(){
  const start=startScene(),depth={},P={};
  if(start){depth[start]=0;const q=[start];while(q.length){const n=q.shift();out(n).forEach(c=>{if(get("scenes",c.vers)&&depth[c.vers]===undefined){depth[c.vers]=depth[n]+1;q.push(c.vers)}})}}
  let maxD=Math.max(0,...Object.values(depth));
  const cols={};
  scenesSorted().forEach(s=>{let d=depth[s.id];if(d===undefined)d=maxD+1;(cols[d]=cols[d]||[]).push(s.id)});
  Object.entries(cols).forEach(([d,ids])=>ids.forEach((id,i)=>{P[id]=[PAD+d*GX,PAD+i*GY]}));
  list("scenes").forEach(s=>{if(typeof s.x==="number"&&typeof s.y==="number")P[s.id]=[s.x,s.y]});
  return P;
}
R_.graphe=()=>{
  if(!list("scenes").length)return `<div class="panel empty">Aucune scène. Crée la première, puis ajoute les choix qui mènent aux suivantes.<br><br><button class="btn primary" data-act="newScene">+ Première scène</button></div>`;
  if(!st.gSel||(st.gSel.k==="s"&&!get("scenes",st.gSel.id))||(st.gSel.k==="c"&&!get("choix",st.gSel.id)))st.gSel={k:"s",id:startScene()};
  const k=checks(),mode=st.gMode||(isMobile()?"liste":"graphe"),P=layout(),start=startScene();
  const W=Math.max(...Object.values(P).map(p=>p[0]))+NW+PAD,H=Math.max(...Object.values(P).map(p=>p[1]))+NH+PAD;
  let edges="";
  list("choix").forEach(c=>{if(!P[c.de]||!P[c.vers])return;const [x1,y1]=P[c.de],[x2,y2]=P[c.vers];
    const back=x2<=x1;const sx=x1+NW,sy=y1+NH/2,ex=back?x2+NW/2:x2,ey=back?y2+(y2>y1?0:NH):y2+NH/2;
    const mx=(sx+ex)/2,d=back?`M${sx},${sy} C${sx+80},${sy} ${ex},${ey+(y2>y1?-80:80)} ${ex},${ey+(y2>y1?-6:6)}`:`M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex-6},${ey}`;
    const sel=st.gSel.k==="c"&&st.gSel.id===c.id,lit=st.gSel.k==="s"&&(c.de===st.gSel.id||c.vers===st.gSel.id);
    const lx=(sx+ex)/2,ly=(sy+ey)/2,has=(c.cond||[]).length;
    edges+=`<g class="gedge ${has?"cond":""} ${sel?"sel":""} ${lit&&!sel?"lit":""}" data-gc="${c.id}"><path d="${d}" marker-end="url(#arr)"/><path class="hit" d="${d}"/>${has?`<circle cx="${lx}" cy="${ly}" r="9"/><text x="${lx}" y="${ly+3.5}" text-anchor="middle">?</text>`:""}<title>${esc(c.texte)}${has?" — si "+esc(condTxt(c.cond)):""}</title></g>`});
  const nodes=list("scenes").map(s=>{const [x,y]=P[s.id],w=k.impasses.includes(s.id)||k.inatteignables.includes(s.id);const t=s.titre||"Sans titre";
    return `<g class="gnode ${s.fin?"end":""} ${w?"warn":""} ${s.id===start?"start":""} ${st.gSel.k==="s"&&st.gSel.id===s.id?"sel":""}" data-gs="${s.id}" data-drag="${s.id}"><rect x="${x}" y="${y}" width="${NW}" height="${NH}" rx="11"/><text x="${x+12}" y="${y+23}">${esc(t.length>22?t.slice(0,21)+"…":t)}</text><text class="sub" x="${x+12}" y="${y+42}">${s.id===start?"Début · ":""}Ch. ${s.chap||1} · ${s.fin?"fin":STATUTS[s.statut]||"idée"}${w?" · ⚠":""}</text></g>`}).join("");
  const svg=`<svg class="graph" id="gsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><marker id="arr" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="var(--muted)"/></marker></defs>${edges}${nodes}</svg>`;
  const lst=`<div class="glist grid" style="gap:14px;${mode==="liste"?"display:grid":""}">${Array.from({length:nChap()},(_,i)=>i+1).map(n=>{const ss=scenesSorted().filter(s=>(+s.chap||1)===n);return ss.length?`<div><div class="lbl">Chapitre ${n}</div><div class="grid" style="gap:10px">${ss.map(s=>`<div class="panel" style="padding:12px 14px;${k.impasses.includes(s.id)||k.inatteignables.includes(s.id)?"border-color:var(--warn);border-style:dashed":""}${s.fin?";background:var(--good-soft);border-color:var(--good)":""}">
    <button style="all:unset;cursor:pointer;display:flex;gap:8px;align-items:center;width:100%" data-gs="${s.id}"><b style="flex:1;min-width:0">${s.id===start?"▶ ":""}${esc(s.titre)}</b>${stat(s.statut)}</button>
    <div class="grid" style="gap:6px;margin-top:8px">${out(s.id).map(c=>`<button class="choice" data-gc="${c.id}" style="text-align:left"><span style="font-size:13.5px;font-weight:600">→ ${esc(c.texte)}</span>${(c.cond||[]).length?`<span class="cond">🔒 si ${esc(condTxt(c.cond))}</span>`:""}<span class="chips">${effHtml(c.eff)}<span class="note">vers « ${esc(sceneT(c.vers))} »</span></span></button>`).join("")||(s.fin?`<span class="note">Fin : ${esc(s.fin)}</span>`:`<span class="chip warn">Aucun choix sortant</span>`)}</div></div>`).join("")}</div></div>`:""}).join("")}</div>`;
  return `<div class="toolbar"><div class="seg" style="width:auto"><button data-gmode="graphe" aria-pressed="${mode==="graphe"}">Graphe</button><button data-gmode="liste" aria-pressed="${mode==="liste"}">Liste</button></div><span class="note hide-m">Glisse une scène pour la ranger. Pointillés = choix avec condition.</span><span class="spacer"></span>${mode==="graphe"?'<button class="btn sm ghost" data-act="relayout">Ranger automatiquement</button>':""}<button class="btn sm" data-go="lecture"><svg viewBox="0 0 24 24">${ICON.lecture}</svg>Tester</button><button class="btn primary sm" data-act="newScene">+ Scène</button></div>
  <div class="gx"><div style="min-width:0">${mode==="graphe"?`<div class="graph-wrap">${svg}</div>`:""}${lst}</div>
  <div class="grid" style="align-content:start">${isMobile()?"":gPanel()}${varsPanel()}</div></div>`;
};
function gPanel(){
  if(st.gSel.k==="c"){const c=get("choix",st.gSel.id);if(!c)return"";return `<div class="panel"><div class="panel-h"><span class="chip acc">Choix</span><h2 style="flex:1">${esc(c.texte)}</h2></div><div class="panel-b grid" style="gap:12px">
    <dl class="kv" style="grid-template-columns:90px 1fr"><dt>De</dt><dd><button class="chip" data-gs="${c.de}">${esc(sceneT(c.de))}</button></dd><dt>Vers</dt><dd><button class="chip" data-gs="${c.vers}">${esc(sceneT(c.vers))}</button></dd>
    <dt>Condition</dt><dd>${(c.cond||[]).length?`<span class="cond">🔒 ${esc(condTxt(c.cond))}</span>`:'<span class="note">Toujours visible</span>'}</dd><dt>Effets</dt><dd><div class="chips">${effHtml(c.eff)||'<span class="note">Aucun</span>'}</div></dd></dl>
    <button class="btn sm" data-act="editChoice" data-id="${c.id}">Modifier le choix</button></div></div>`}
  const id=st.gSel.id,s=get("scenes",id),k=checks();if(!s)return"";
  return `<div class="panel"><div class="panel-h"><h2 style="flex:1">${esc(s.titre)}</h2>${stat(s.statut)}</div><div class="panel-b grid" style="gap:12px">
    ${k.impasses.includes(id)?'<span class="chip warn">Impasse : aucun choix sortant</span>':""}${k.inatteignables.includes(id)?'<span class="chip warn">Aucun chemin depuis le début</span>':""}
    <div class="note">Chapitre ${s.chap||1}${s.lieu?" · "+esc(lieuNom(s.lieu)):""} · ${words(s.texte)} mots${s.fin?" · Fin : "+esc(s.fin):""}</div>
    <div class="chips">${(s.persos||[]).map(p=>`<button class="chip" data-char-go="${p}">${av(p,"sm")}${esc(short(p))}</button>`).join("")}</div>
    <div><div class="lbl">Choix sortants</div><div class="grid" style="gap:8px">${out(id).map(c=>`<button class="choice" data-gc="${c.id}" style="text-align:left"><b>${esc(c.texte)}</b>${(c.cond||[]).length?`<span class="cond">🔒 si ${esc(condTxt(c.cond))}</span>`:""}<span class="chips">${effHtml(c.eff)}<span class="note">→ ${esc(sceneT(c.vers))}</span></span></button>`).join("")||'<span class="note">Aucun.</span>'}</div>
    <button class="btn sm" style="margin-top:8px" data-act="addChoice" data-id="${id}">+ Ajouter un choix</button></div>
    <div class="chips"><button class="btn sm primary" data-scene="${id}">Écrire</button><button class="btn sm" data-readfrom="${id}">Lire depuis ici</button>${startScene()===id?"":`<button class="btn sm ghost" data-act="setStart" data-id="${id}">Faire le début</button>`}</div></div></div>`;
}
function varsPanel(){
  return `<div class="panel"><div class="panel-h"><h2>Jauges et drapeaux</h2><button class="btn sm ghost" style="margin-left:auto" data-act="newVar">+ Ajouter</button></div><div class="panel-b vars">${vars().map(v=>`<button class="var" style="all:unset;display:flex;gap:10px;align-items:center;cursor:pointer;font-size:13.5px" data-act="editVar" data-id="${v.id}"><span class="chip ${v.type==="jauge"?"acc":"ink"}">${v.type}</span><span class="k">${esc(v.nom)}</span><span class="note tnum">${v.type==="jauge"?"départ "+(v.depart??0)+" / "+(v.max??10):"départ "+(v.depart?"oui":"non")}</span></button>`).join("")||'<p class="note" style="margin:0">Une jauge compte (Affinité Lina, de 0 à 10). Un drapeau retient un fait (A lu la lettre).</p>'}</div></div>`;
}
function varForm(v){
  const isNew=!v;v=v||{nom:"",type:"jauge",depart:0,max:10};
  openDrawer(isNew?"Nouvelle jauge ou drapeau":v.nom,`<form id="vf" class="grid" style="gap:14px">
   <div class="field"><label for="vN">Nom</label><input id="vN" value="${esc(v.nom)}" required placeholder="Affinité Lina"></div>
   <div class="field"><label for="vT">Type</label><select id="vT"><option value="jauge" ${v.type==="jauge"?"selected":""}>Jauge (un nombre)</option><option value="drapeau" ${v.type==="drapeau"?"selected":""}>Drapeau (oui ou non)</option></select></div>
   <div class="field" id="vJ"><label for="vD">Valeur de départ</label><input id="vD" type="number" value="${v.type==="jauge"?v.depart??0:0}"><label for="vM">Maximum</label><input id="vM" type="number" value="${v.max??10}"></div>
   <button class="btn primary">Enregistrer</button>
   ${isNew?"":`<button type="button" class="btn ghost danger" data-act="delVar" data-id="${v.id}">Supprimer</button><p class="note" style="margin:0">Utilisée par ${list("choix").filter(c=>(c.cond||[]).some(x=>x[0]===v.id)||(c.eff||[]).some(x=>x[0]===v.id)).length} choix.</p>`}</form>`);
  const tog=()=>$("#vJ").hidden=$("#vT").value!=="jauge";tog();$("#vT").onchange=tog;
  $("#vf").onsubmit=e=>{e.preventDefault();const o=isNew?{}:v;const t=$("#vT").value;Object.assign(o,{nom:$("#vN").value,type:t,depart:t==="jauge"?+$("#vD").value:false,max:+$("#vM").value||10});save("variables",o,0);closeDrawer();render()};
}
function choiceForm(c,from){
  const isNew=!c;c=c?JSON.parse(JSON.stringify(c)):{de:from,texte:"",vers:"",cond:[],eff:[]};
  const draw=()=>{
    const vs=vars();
    $("#dBody").innerHTML=`<form id="cf" class="grid" style="gap:14px">
    <div class="note">Depuis « ${esc(sceneT(c.de))} »</div>
    <div class="field"><label for="ct">Texte affiché au lecteur</label><input id="ct" value="${esc(c.texte)}" placeholder="Tu acceptes l'invitation…" required></div>
    <div class="field"><label for="cv">Mène à</label><select id="cv"><option value="__new">+ Nouvelle scène…</option>${scenesSorted().map(s=>`<option value="${s.id}" ${s.id===c.vers?"selected":""}>Ch. ${s.chap||1} · ${esc(s.titre)}</option>`).join("")}</select><input id="cvn" placeholder="Titre de la nouvelle scène" ${c.vers?"hidden":""}></div>
    <div><div class="lbl">Condition pour que le choix apparaisse</div><div class="grid" style="gap:8px">${c.cond.map(([v,op,val],i)=>{const V=get("variables",v);return `<div class="rowform"><select data-ci="${i}" data-cp="0">${vs.map(x=>`<option value="${x.id}" ${x.id===v?"selected":""}>${esc(x.nom)}</option>`).join("")}</select>${V&&V.type==="drapeau"?`<select data-ci="${i}" data-cp="2b"><option value="1" ${val?"selected":""}>est vrai</option><option value="0" ${!val?"selected":""}>est faux</option></select>`:`<select data-ci="${i}" data-cp="1">${Object.entries(OPS).map(([o,l])=>`<option value="${o}" ${o===op?"selected":""}>${l}</option>`).join("")}</select><input type="number" data-ci="${i}" data-cp="2" value="${val}">`}<button type="button" class="x" data-act="cDel" data-i="${i}" aria-label="Retirer"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`}).join("")}
      ${vs.length?'<button type="button" class="btn sm" style="justify-self:start" data-act="cAdd">+ Condition</button>':'<span class="note">Crée d\'abord une jauge ou un drapeau (panneau du graphe).</span>'}</div></div>
    <div><div class="lbl">Effets quand le lecteur le choisit</div><div class="grid" style="gap:8px">${vs.map(v=>{const e=c.eff.find(x=>x[0]===v.id);return `<div class="var"><span class="k">${esc(v.nom)}</span>${v.type==="jauge"?`<input type="number" data-ev2="${v.id}" value="${e?e[1]:""}" placeholder="0" style="width:72px;border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:5px 8px">`:`<select data-ef="${v.id}" style="border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:5px 8px"><option value="">—</option><option value="1" ${e&&e[1]===true?"selected":""}>devient vrai</option><option value="0" ${e&&e[1]===false?"selected":""}>devient faux</option></select>`}</div>`}).join("")||'<span class="note">Aucune jauge ni drapeau.</span>'}</div></div>
    <button class="btn primary">Enregistrer</button>
    ${isNew?"":`<button type="button" class="btn ghost danger" data-act="delChoice" data-id="${c.id}">Supprimer le choix</button>`}</form>`;
    $("#cv").onchange=()=>{$("#cvn").hidden=$("#cv").value!=="__new"};
    if(!c.vers){$("#cv").value="__new"}
    $$("[data-ci]").forEach(el=>el.addEventListener("change",()=>{const i=+el.dataset.ci,p=el.dataset.cp;sync();if(p==="0"){const V=get("variables",el.value);c.cond[i]=V.type==="drapeau"?[el.value,"=",true]:[el.value,">=",1];draw()}else if(p==="1")c.cond[i][1]=el.value;else if(p==="2")c.cond[i][2]=+el.value;else c.cond[i][2]=el.value==="1"}));
    $("#cf").onsubmit=e=>{e.preventDefault();sync();
      let vers=$("#cv").value;
      if(vers==="__new"){const t=$("#cvn").value.trim()||c.texte||"Nouvelle scène";const from=get("scenes",c.de);const s=save("scenes",{titre:t,chap:from?+from.chap||1:1,statut:"idee",persos:[],texte:""},0);vers=s.id}
      const o=isNew?{}:get("choix",c.id);
      Object.assign(o,{de:c.de,vers,texte:c.texte,cond:c.cond,eff:c.eff,ordre:isNew?out(c.de).length:o.ordre});
      save("choix",o,0);closeDrawer();if(st.view==="graphe")st.gSel={k:"c",id:o.id};render();toast("Choix enregistré.")};
  };
  const sync=()=>{const t=$("#ct");if(!t)return;c.texte=t.value;const v=$("#cv").value;c.vers=v==="__new"?"":v;
    c.eff=[];$$("[data-ev2]").forEach(i=>{if(i.value!==""&&+i.value!==0)c.eff.push([i.dataset.ev2,+i.value])});$$("[data-ef]").forEach(s=>{if(s.value!=="")c.eff.push([s.dataset.ef,s.value==="1"])});
    $$("[data-cp='2']").forEach(i=>c.cond[+i.dataset.ci][2]=+i.value)};
  CF={c,draw,sync};
  openDrawer(isNew?"Nouveau choix":"Modifier le choix","");draw();
  setTimeout(()=>$("#ct")&&!c.texte&&$("#ct").focus(),200);
}
let CF=null;
after.graphe=()=>{
  const svg=$("#gsvg");if(!svg)return;
  let drag=null;
  svg.addEventListener("pointerdown",e=>{const g=e.target.closest("[data-drag]");if(!g||isMobile())return;const id=g.dataset.drag,P=layout();drag={id,g,sx:e.clientX,sy:e.clientY,ox:P[id][0],oy:P[id][1],moved:false};g.setPointerCapture(e.pointerId)});
  svg.addEventListener("pointermove",e=>{if(!drag)return;const dx=e.clientX-drag.sx,dy=e.clientY-drag.sy;if(!drag.moved&&Math.hypot(dx,dy)<5)return;drag.moved=true;drag.g.classList.add("dragging");drag.g.setAttribute("transform",`translate(${dx},${dy})`)});
  svg.addEventListener("pointerup",e=>{if(!drag)return;const d=drag;drag=null;if(!d.moved)return;
    const s=get("scenes",d.id);s.x=Math.max(PAD,Math.round((d.ox+e.clientX-d.sx)/10)*10);s.y=Math.max(PAD,Math.round((d.oy+e.clientY-d.sy)/10)*10);
    const P=layout();list("scenes").forEach(x=>{if(typeof x.x!=="number"){x.x=P[x.id][0];x.y=P[x.id][1];save("scenes",x,1500)}});
    save("scenes",s,1000);st.justDragged=true;setTimeout(()=>st.justDragged=false,50);render()});
};

/* --- matrice des choix --- */
R_.matrice=()=>{
  const vs=vars();
  const cell=(c,v)=>{const e=(c.eff||[]).find(x=>x[0]===v.id);if(!e)return `<td class="num muted">·</td>`;if(v.type==="drapeau")return `<td class="num" style="color:var(--ink)">${e[1]?"⚑":"✕"}</td>`;return `<td class="num" style="color:var(--${e[1]>0?"good":"bad"});background:color-mix(in srgb,var(--${e[1]>0?"good":"bad"}) ${8+Math.min(5,Math.abs(e[1]))*6}%,transparent)">${e[1]>0?"+":""}${e[1]}</td>`};
  const scenes=scenesSorted().filter(s=>out(s.id).length);
  if(!scenes.length)return '<div class="panel empty">Aucun choix pour l\'instant. Ajoute-les depuis le graphe ou l\'éditeur.</div>';
  const desk=`<div class="mx-wrap cm-desk"><table class="cm" style="min-width:${420+vs.length*110}px"><thead><tr><th>Choix</th><th>Condition</th>${vs.map(v=>`<th style="text-align:center">${esc(v.nom)}</th>`).join("")}<th>Mène à</th></tr></thead><tbody>${scenes.map(s=>`<tr class="scene-row"><td colspan="${vs.length+3}">${esc(s.titre)}</td></tr>${out(s.id).map(c=>`<tr><td><button style="all:unset;cursor:pointer;font-weight:600" data-act="editChoice" data-id="${c.id}">${esc(c.texte)}</button></td><td>${(c.cond||[]).length?`<span class="cond">🔒 ${esc(condTxt(c.cond))}</span>`:'<span class="note">—</span>'}</td>${vs.map(v=>cell(c,v)).join("")}<td><button class="chip" data-gsel="${c.vers}">${esc(sceneT(c.vers))}</button></td></tr>`).join("")}`).join("")}</tbody></table></div>`;
  const mob=`<div class="cm-cards">${scenes.map(s=>`<div class="lbl" style="margin-top:6px">${esc(s.titre)}</div>${out(s.id).map(c=>`<button class="choice" data-act="editChoice" data-id="${c.id}" style="text-align:left;background:var(--surface)"><b>${esc(c.texte)}</b>${(c.cond||[]).length?`<span class="cond">🔒 si ${esc(condTxt(c.cond))}</span>`:""}<span class="chips">${effHtml(c.eff)||'<span class="note">Aucun effet</span>'}</span><span class="note">→ ${esc(sceneT(c.vers))}</span></button>`).join("")}`).join("")}</div>`;
  const totals=vs.filter(v=>v.type==="jauge").map(v=>{const max=list("choix").reduce((a,c)=>{const e=(c.eff||[]).find(x=>x[0]===v.id);return a+(e&&e[1]>0?e[1]:0)},0);return `<span class="chip">${esc(v.nom)} : départ ${v.depart??0}, jusqu'à +${max} au total</span>`}).join("");
  return `<div class="toolbar"><span class="note">Chaque ligne est un choix, chaque colonne une jauge ou un drapeau.</span><span class="spacer"></span><div class="chips">${totals}</div></div>${desk}${mob}`;
};

/* --- éditeur --- */
function newScene(){const s=save("scenes",{titre:"Nouvelle scène",chap:st.chap||1,statut:"idee",persos:[],texte:""},0);if(!DB.projet.depart){DB.projet.depart=s.id;saveProjet()}st.edScene=s.id;go("scene");setTimeout(()=>{const t=$("#edTitle");if(t){t.focus();t.select()}},60);return s}
function saveProjet(){api("PUT","/api/project?path="+encodeURIComponent(PATH),DB.projet).catch(()=>toast("Le Mac ne répond pas : réglage non enregistré."))}
R_.scene=()=>{
  if(!list("scenes").length)return `<div class="panel empty">Aucune scène pour l'instant.<br><br><button class="btn primary" data-act="newScene">+ Première scène</button></div>`;
  if(!st.edScene||!get("scenes",st.edScene)){const last=list("scenes").slice().sort((a,b)=>String(b.modifie||"").localeCompare(String(a.modifie||"")))[0];st.edScene=last.id}
  const id=st.edScene,s=get("scenes",id);
  return `<div class="ed-bar"><select id="edPick" class="btn sm hide-focus" aria-label="Choisir la scène" style="max-width:100%">${scenesSorted().map(x=>`<option value="${x.id}" ${x.id===id?"selected":""}>Ch. ${x.chap||1} · ${esc(x.titre)}</option>`).join("")}</select>
    <button class="btn sm hide-focus" data-act="newScene">+ Scène</button>
    <span class="spacer" style="flex:1"></span><span class="note tnum" id="wc"></span>
    <button class="btn sm only-m hide-focus" data-act="edSide">Fiches et choix</button>
    <button class="btn sm" data-act="focus"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>Focus</button></div>
  <div class="ed">
    <div class="panel paper" style="position:relative">
      <input class="t" id="edTitle" value="${esc(s.titre)}" aria-label="Titre de la scène">
      <div class="ed-meta hide-focus">
        <select id="edChap" aria-label="Chapitre">${Array.from({length:nChap()},(_,i)=>`<option value="${i+1}" ${(+s.chap||1)===i+1?"selected":""}>Chapitre ${i+1}</option>`).join("")}</select>
        <select id="edLieu" aria-label="Lieu"><option value="">Lieu…</option>${list("lieux").map(l=>`<option value="${l.id}" ${l.id===s.lieu?"selected":""}>${esc(l.nom)}</option>`).join("")}<option value="__new">+ Nouveau lieu</option></select>
        ${Object.keys(STATUTS).map(x=>`<button class="status st-${x}" style="border:0;${x===(s.statut||"idee")?"outline:2px solid currentColor":"opacity:.55"}" data-statut="${x}">${STATUTS[x]}</button>`).join("")}
        <label class="note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="edFin" ${s.fin?"checked":""} style="accent-color:var(--accent)">C'est une fin</label>
        ${s.fin?`<input id="edFinT" class="inline-in" style="width:220px;border-color:var(--line)" value="${esc(s.fin)}" placeholder="Fin heureuse avec…">`:""}
      </div>
      <textarea id="edText" aria-label="Texte de la scène" spellcheck="true" placeholder="Écris ici. Tape @ pour citer un personnage ou un lieu.">${esc(s.texte||"")}</textarea>
      <div class="mention-pop" id="mpop" hidden></div>
    </div>
    <div class="grid ed-side hide-m" style="align-content:start">${edSide(id)}</div>
  </div>`;
};
function edSide(id){
  const s=get("scenes",id),ps=s.persos||[],ch=+s.chap||1;
  const rh=[];ps.forEach(a=>ps.forEach(b=>{if(a!==b){const r=relObj(a,b),e=relAt(r,ch);if(e)rh.push([a,b,e])}}));
  return `<div class="panel"><div class="panel-h"><h2>Personnages présents</h2></div><div class="panel-b grid" style="gap:10px">
    <div class="pick">${chars().map(c=>`<button data-act="togglePerso" data-id="${c.id}" aria-pressed="${ps.includes(c.id)}">${esc(c.nom)}</button>`).join("")||'<span class="note">Aucun personnage.</span>'}</div>
    <div class="list">${ps.filter(p=>get("personnages",p)).map(p=>`<button class="row" style="border-left:0;border-right:0;border-top:0;background:none;width:100%;text-align:left" data-char-go="${p}">${av(p,"sm")}<div class="grow"><b>${esc(cname(p))}</b><small>${esc(get("personnages",p).voix||get("personnages",p).role||"")}</small></div></button>`).join("")}</div></div></div>
  <div class="panel"><div class="panel-h"><h2>Relations à ce point</h2><span class="chip">ch. ${ch}</span></div><div class="panel-b list">${rh.map(([a,b,e])=>`<div class="row"><div class="grow"><b>${esc(short(a))} → ${esc(short(b))}</b><small>${esc(e.note||"")}</small></div>${rtag(e.type)}</div>`).join("")||'<span class="note">Rien à afficher.</span>'}</div></div>
  <div class="panel"><div class="panel-h"><h2>Choix sortants</h2></div><div class="panel-b grid" style="gap:8px">${out(id).map(c=>`<button class="choice" style="text-align:left" data-act="editChoice" data-id="${c.id}"><b>${esc(c.texte)}</b>${(c.cond||[]).length?`<span class="cond">🔒 si ${esc(condTxt(c.cond))}</span>`:""}<span class="chips">${effHtml(c.eff)}<span class="note">→ ${esc(sceneT(c.vers))}</span></span></button>`).join("")||(s.fin?'<span class="note">Scène de fin.</span>':'<span class="chip warn">Aucun choix : impasse</span>')}
    <div class="chips"><button class="btn sm" data-act="addChoice" data-id="${id}">+ Choix</button><button class="btn sm" data-readfrom="${id}">Lire depuis ici</button><button class="btn sm ghost" data-act="history" data-id="${id}">Versions</button></div>
    ${st.confirm==="scene"?`<div class="confirm"><span>Supprimer cette scène et ses choix sortants ?</span><div class="chips"><button class="btn sm danger" data-act="delScene" data-id="${id}">Supprimer</button><button class="btn sm" data-act="noConfirm">Annuler</button></div></div>`:`<button class="btn sm ghost danger" style="justify-self:start" data-act="askConfirm" data-what="scene">Supprimer la scène</button>`}</div></div>`;
}
after.scene=()=>{
  const ta=$("#edText");if(!ta)return;
  const id=st.edScene,s=get("scenes",id),wc=$("#wc");
  const count=()=>{wc.textContent=words(ta.value)+" mots"};count();
  ta.addEventListener("input",()=>{s.texte=ta.value;count();save("scenes",s,1500);mention(ta)});
  ta.addEventListener("keydown",e=>{const p=$("#mpop");if(!p.hidden&&(e.key==="Enter"||e.key==="Tab")){e.preventDefault();p.querySelector("button")?.click()}if(e.key==="Escape")p.hidden=true});
  ta.addEventListener("blur",()=>{if(pend["scenes/"+id]){clearTimeout(pend["scenes/"+id].timer);flush("scenes/"+id)}});
  $("#edTitle").addEventListener("input",e=>{s.titre=e.target.value;save("scenes",s)});
  $("#edPick").addEventListener("change",e=>{st.edScene=e.target.value;st.confirm=null;ls.set("apo-view:"+PATH,{view:"scene",edScene:st.edScene});render()});
  $("#edChap").addEventListener("change",e=>{s.chap=+e.target.value;save("scenes",s,0);render()});
  $("#edLieu").addEventListener("change",e=>{if(e.target.value==="__new"){const n=prompt2("Nom du lieu",nom=>{const l=save("lieux",{nom,description:""},0);s.lieu=l.id;save("scenes",s,0);render()});e.target.value=s.lieu||"";return}s.lieu=e.target.value;save("scenes",s,0)});
  $("#edFin").addEventListener("change",e=>{s.fin=e.target.checked?"Fin":"";save("scenes",s,0);render()});
  const ft=$("#edFinT");ft&&ft.addEventListener("input",()=>{s.fin=ft.value||"Fin";save("scenes",s)});
};
function prompt2(label,cb){openDrawer(label,`<form id="p2" class="grid" style="gap:12px"><div class="field"><label for="p2i">${esc(label)}</label><input id="p2i" required></div><button class="btn primary">Créer</button></form>`);setTimeout(()=>$("#p2i").focus(),200);$("#p2").onsubmit=e=>{e.preventDefault();const v=$("#p2i").value.trim();closeDrawer();if(v)cb(v)}}
function mention(ta){
  const p=$("#mpop"),before=ta.value.slice(0,ta.selectionStart),m=before.match(/@([\wÀ-ÿ'-]*)$/);
  if(!m){p.hidden=true;return}
  const q=m[1].toLowerCase();
  const items=[...chars().map(c=>({l:c.nom,id:c.id})),...list("lieux").map(l=>({l:l.nom,lieu:l.id}))].filter(x=>x.l.toLowerCase().includes(q)).slice(0,6);
  if(!items.length){p.hidden=true;return}
  p.innerHTML=items.map((x,i)=>`<button class="${i?"":"on"}" data-mention="${esc(x.l)}" data-mid="${x.id||""}" data-mlieu="${x.lieu||""}">${x.id?av(x.id,"sm"):'<span class="chip ink" style="padding:2px 6px">lieu</span>'}${esc(x.l)}</button>`).join("");
  const lines=before.split("\n").length;
  p.style.left="clamp(16px,6vw,56px)";p.style.top=Math.min(ta.offsetTop+ta.clientHeight-20,ta.offsetTop+20+lines*28)+"px";p.hidden=false;
}
async function showHistory(id){
  openDrawer("Versions de la scène",'<p class="note">Chargement…</p>');
  try{const vs=await api("GET",`/api/history?path=${encodeURIComponent(PATH)}&id=${id}`);
    $("#dBody").innerHTML=vs.length?`<p class="note" style="margin:0">Une version est gardée au plus toutes les 10 minutes d'écriture.</p><div class="hist">${vs.map(v=>`<button class="btn" data-act="showVer" data-id="${id}" data-v="${v}">${v.replace(".md","").replace("_"," à ").replace(/-(\d\d)-(\d\d)$/,":$1")}</button>`).join("")}</div><div id="verBox"></div>`:'<p class="note">Pas encore d\'ancienne version. Elles apparaissent quand tu modifies une scène déjà écrite.</p>';
  }catch(e){$("#dBody").innerHTML='<p class="note">Le Mac ne répond pas.</p>'}
}

/* --- lecture --- */
function startRead(from){const vs={};vars().forEach(v=>vs[v.id]=v.type==="jauge"?(+v.depart||0):!!v.depart);st.read={scene:from||startScene(),vars:vs,path:[from||startScene()],last:{}}}
R_.lecture=()=>{
  if(!list("scenes").length)return '<div class="panel empty">Écris au moins une scène pour tester une branche.</div>';
  if(!st.read||!get("scenes",st.read.scene))startRead();
  const r=st.read,s=get("scenes",r.scene),opts=out(r.scene);
  const shown=opts.filter(c=>st.showLocked||okCond(c.cond,r.vars));
  const jauges=vars().filter(v=>v.type==="jauge"),flags=vars().filter(v=>v.type==="drapeau");
  return `<div class="toolbar"><span class="note">Joue l'histoire comme un lecteur pour vérifier une branche.</span><span class="spacer"></span><label class="note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="lk" ${st.showLocked?"checked":""} style="accent-color:var(--accent)">Montrer les choix verrouillés</label>${r.path.length>1?'<button class="btn sm" data-act="back">← Retour</button>':""}<button class="btn sm" data-act="restart">Recommencer</button></div>
  <div class="rd"><div class="panel story">
      <div class="chap">Chapitre ${s.chap||1}</div><h2>${esc(s.titre)}</h2>
      <div class="prose">${(s.texte||"").split("\n").filter(p=>p.trim()).map(p=>`<p>${esc(p)}</p>`).join("")||'<p class="muted">(Scène encore vide.)</p>'}</div>
      ${s.fin?`<div class="ending"><div class="lbl" style="color:var(--good)">Fin atteinte</div><h3>${esc(s.fin)}</h3><p class="note" style="margin:6px 0 12px">Chemin parcouru en ${r.path.length} scènes.</p><button class="btn primary" data-act="restart">Rejouer une autre branche</button></div>`:
      opts.length?`<div class="opts">${shown.map(c=>{const ok=okCond(c.cond,r.vars);return `<button class="opt ${ok?"":"locked"}" ${ok?`data-pick="${c.id}"`:`disabled`}>${ok?"":"🔒 "}${esc(c.texte)}${ok?'<span class="arrow">→</span>':`<span class="cond" style="margin-left:auto">${esc(condTxt(c.cond))}</span>`}</button>`}).join("")}${!shown.some(c=>okCond(c.cond,r.vars))?'<div class="impasse"><b>Bloqué</b><p class="note" style="margin:4px 0 0">Aucun choix n\'est accessible avec ces jauges. Le lecteur serait coincé ici.</p></div>':""}</div>`:
      `<div class="impasse"><b>Impasse</b><p class="note" style="margin:4px 0 10px">Cette scène n'a pas encore de choix sortant.</p><button class="btn sm" data-scene="${r.scene}">Écrire la suite</button></div>`}
      <div style="margin-top:18px"><button class="btn sm ghost" data-scene="${r.scene}">Modifier cette scène</button></div>
    </div>
    <div class="grid rd-side" style="align-content:start">
      ${jauges.length?`<div class="panel"><div class="panel-h"><h2>Jauges</h2></div><div class="panel-b grid" style="gap:12px">${jauges.map(v=>`<div><div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:600;margin-bottom:4px"><span>${esc(v.nom)}</span><span class="tnum">${r.last[v.id]?`<span class="delta ${r.last[v.id]>0?"p":"n"}">${r.last[v.id]>0?"+":""}${r.last[v.id]}</span> `:""}${r.vars[v.id]} / ${v.max??10}</span></div><div class="gbar"><i style="width:${Math.max(0,Math.min(100,r.vars[v.id]/(v.max||10)*100))}%"></i></div></div>`).join("")}</div></div>`:""}
      ${flags.length?`<div class="panel"><div class="panel-h"><h2>Drapeaux</h2></div><div class="panel-b vars">${flags.map(v=>`<div class="var"><span class="k">${esc(v.nom)}</span>${r.vars[v.id]?`<span class="chip ink">${r.last[v.id]!==undefined?"✦ ":""}oui</span>`:'<span class="chip">non</span>'}</div>`).join("")}</div></div>`:""}
      <div class="panel"><div class="panel-h"><h2>Chemin</h2></div><div class="panel-b path">${r.path.map((p,i)=>`<span>${i+1}. ${esc(sceneT(p))}</span>`).join("")}</div></div>
    </div></div>`;
};
after.lecture=()=>{const l=$("#lk");l&&l.addEventListener("change",e=>{st.showLocked=e.target.checked;render()})};
function pick(cid){const c=get("choix",cid),r=st.read;r.hist=r.hist||[];r.hist.push(JSON.stringify({scene:r.scene,vars:r.vars,path:r.path}));r.last={};(c.eff||[]).forEach(([v,x])=>{const V=get("variables",v);if(!V)return;if(V.type==="jauge"){const n=Math.max(0,Math.min(V.max||10,(r.vars[v]||0)+x));r.last[v]=n-(r.vars[v]||0);r.vars[v]=n}else{r.last[v]=x;r.vars[v]=x}});r.scene=c.vers;r.path=[...r.path,c.vers];render();window.scrollTo({top:0,behavior:"smooth"})}

/* --- idées --- */
R_.idees=()=>{
  const all=list("idees").slice().sort((a,b)=>String(b.cree||"").localeCompare(String(a.cree||"")));
  const l=all.filter(i=>st.ideaFilter==="tous"||i.tri!==false);
  return `<div class="toolbar"><div class="seg" style="width:auto"><button data-ifilter="tri" aria-pressed="${st.ideaFilter==="tri"}">À trier (${all.filter(i=>i.tri!==false).length})</button><button data-ifilter="tous" aria-pressed="${st.ideaFilter==="tous"}">Toutes (${all.length})</button></div><span class="spacer"></span><button class="btn primary sm" data-act="idea">+ Idée</button></div>
  <div class="ideas">${l.map(i=>`<div class="panel idea ${i.tri===false?"done":""}"><p>${esc(i.texte)}</p><div class="chips">${(i.tags||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join("")}${i.tri!==false?'<span class="chip acc">à trier</span>':'<span class="chip good">triée</span>'}<span class="note">${fmtDate(Date.parse(i.cree))}</span></div><div class="acts">${i.tri!==false?`<button class="btn sm" data-conv="${i.id}" data-to="scene">→ Scène</button><button class="btn sm" data-conv="${i.id}" data-to="ev">→ Événement</button><button class="btn sm" data-conv="${i.id}" data-to="done">Triée</button>`:""}<button class="btn sm ghost danger" data-act="delIdea" data-id="${i.id}">Supprimer</button></div></div>`).join("")||'<div class="panel empty">Rien à trier.</div>'}</div>`;
};
function ideaSheet(){
  const tags=[...new Set(list("idees").flatMap(i=>i.tags||[]))].slice(0,10);
  openDrawer("Nouvelle idée",`<div class="field"><label for="it">Note rapide</label><textarea id="it" placeholder="Une réplique, une scène, un retournement…"></textarea></div>
  <div class="field"><label for="itg">Étiquettes</label><input id="itg" placeholder="intrigue, Lina…"><div class="chips">${tags.map(t=>`<button class="chip" data-tagadd="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>
  <button class="btn primary" data-act="saveIdea">Enregistrer l'idée</button>`);
  setTimeout(()=>$("#it")?.focus(),250);
}

/* --- recherche --- */
R_.recherche=()=>`<div class="field only-m" style="margin-bottom:14px"><input id="q2" type="search" placeholder="Rechercher dans tout le projet" value="${esc(st.q)}"></div><div id="results">${results(st.q)}</div>`;
after.recherche=()=>{const i=$("#q2");if(i&&isMobile()){i.focus();i.addEventListener("input",()=>{st.q=i.value;$("#results").innerHTML=results(st.q)})}};
function results(q){
  q=q.trim().toLowerCase();if(q.length<2)return '<div class="empty">Tape au moins deux lettres : un nom, un lieu, une réplique…</div>';
  const hit=t=>String(t||"").toLowerCase().includes(q);
  const snip=t=>{t=String(t||"");const i=t.toLowerCase().indexOf(q);if(i<0)return esc(t.slice(0,110));const a=Math.max(0,i-50);return(a?"…":"")+esc(t.slice(a,i))+"<mark>"+esc(t.slice(i,i+q.length))+"</mark>"+esc(t.slice(i+q.length,i+80))+"…"};
  const groups=[
    ["Personnages",chars().filter(c=>hit(Object.values(c).join(" "))).map(c=>`<div class="row">${av(c.id,"sm")}<div class="grow"><b>${esc(c.nom)}</b><small>${esc(c.role||"")}</small></div><button class="btn sm" data-char-go="${c.id}">Fiche</button></div>`)],
    ["Scènes",scenesSorted().filter(s=>hit(s.titre+" "+s.texte)).map(s=>`<div class="row"><div class="grow"><b>${esc(s.titre)}</b><small>${snip(hit(s.texte)?s.texte:s.titre)}</small></div><button class="btn sm" data-scene="${s.id}">Ouvrir</button></div>`)],
    ["Choix",list("choix").filter(c=>hit(c.texte)).map(c=>`<div class="row"><div class="grow"><b>${esc(c.texte)}</b><small>${esc(sceneT(c.de))} → ${esc(sceneT(c.vers))}</small></div><button class="btn sm" data-act="editChoice" data-id="${c.id}">Voir</button></div>`)],
    ["Événements",list("evenements").filter(e=>hit(e.titre+" "+e.description+" "+e.quand)).map(e=>`<div class="row"><div class="grow"><b>${esc(e.titre)}</b><small>${esc(e.quand||"")}</small></div><button class="btn sm" data-ev="${e.id}">Voir</button></div>`)],
    ["Lieux",list("lieux").filter(l=>hit(l.nom+" "+l.description)).map(l=>`<div class="row"><div class="grow"><b>${esc(l.nom)}</b><small>${esc(l.description||"")}</small></div><button class="btn sm" data-go="lieux">Voir</button></div>`)],
    ["Idées",list("idees").filter(i=>hit(i.texte)).map(i=>`<div class="row"><div class="grow"><small style="color:var(--fg);font-size:14px">${snip(i.texte)}</small></div></div>`)],
  ].filter(g=>g[1].length);
  return groups.length?`<div class="grid">${groups.map(([t,r])=>`<div class="panel"><div class="panel-h"><h2>${t}</h2><span class="chip">${r.length}</span></div><div class="panel-b list">${r.join("")}</div></div>`).join("")}</div>`:`<div class="empty">Aucun résultat pour « ${esc(q)} ».</div>`;
}

/* --- réglages --- */
R_.reglages=()=>`<div class="grid" style="max-width:720px">
  <div class="panel"><div class="panel-h"><h2>Ce roman</h2></div><div class="panel-b grid" style="gap:12px">
    <div class="field"><label for="pT">Titre</label><input id="pT" value="${esc(DB.projet.titre||"")}"></div>
    <div class="field"><label for="pG">Genre</label><input id="pG" value="${esc(DB.projet.genre||"")}"></div>
    <div class="field"><label for="pR">Résumé</label><textarea id="pR">${esc(DB.projet.resume||"")}</textarea></div>
    <div class="field"><label for="pC">Nombre de chapitres</label><input id="pC" type="number" min="1" max="200" value="${nChap()}"></div>
    <button class="btn primary" style="justify-self:start" data-act="saveProj">Enregistrer</button>
    <p class="note" style="margin:0">Dossier sur le Mac : Documents / Apo aventure / ${esc(PATH)}</p></div></div>
  ${accessPanel()}
  <div class="panel"><div class="panel-h"><h2>Affichage</h2></div><div class="panel-b grid" style="gap:10px"><div class="seg" style="max-width:260px"><button data-theme-set="light" aria-pressed="${!document.documentElement.dataset.theme}">Clair</button><button data-theme-set="dark" aria-pressed="${document.documentElement.dataset.theme==="dark"}">Sombre</button></div><div class="seg" style="max-width:260px"><button data-act="txt-">Texte plus petit</button><button data-act="txt+">Texte plus grand</button></div></div></div>
  <div class="panel"><div class="panel-h"><h2>Code d'accès</h2></div><div class="panel-b grid" style="gap:10px"><div class="rowform"><input id="nc" type="password" placeholder="Nouveau code" autocomplete="new-password"><button class="btn sm" data-act="changeCode">Changer le code</button></div><p class="note" style="margin:0">Les autres appareils devront retaper le nouveau code.</p><button class="btn sm ghost" style="justify-self:start" data-act="logout">Se déconnecter sur cet appareil</button></div></div>
  <div class="panel"><div class="panel-h"><h2>Arrêter Apo aventure</h2></div><div class="panel-b grid" style="gap:10px"><p class="note" style="margin:0">Enregistre tout ce qui est en cours puis arrête l'appli sur le Mac. Elle redémarre à la prochaine ouverture de session, ou d'un double-clic sur « Démarrer Apo aventure » dans Applications / Apo aventure.</p>${stopBox()}</div></div>
  <div class="panel"><div class="panel-h"><h2>Autres romans</h2></div><div class="panel-b"><button class="btn" data-act="projects">Changer de roman ou de saga</button></div></div>
</div>`;
after.reglages=fillAccess;

/* ================= ARRÊT ================= */
function stopBox(){return st.confirm==="stop"?`<div class="confirm"><span>Arrêter Apo aventure ? Le Mac et l'iPhone ne pourront plus l'ouvrir jusqu'à la relance.</span><div class="chips"><button class="btn sm danger" data-act="stopApp">Enregistrer et arrêter</button><button class="btn sm" data-act="noConfirm">Annuler</button></div></div>`:`<button class="btn danger" style="justify-self:start" data-act="askConfirm" data-what="stop"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Arrêter l'appli</button>`}
async function stopApp(){
  toast("Enregistrement en cours…");
  flushAll();
  const t0=Date.now();
  while(Object.keys(pend).length&&Date.now()-t0<8000){await new Promise(r=>setTimeout(r,250))}
  if(Object.keys(pend).length){st.confirm=null;render();openDrawer("Arrêt annulé",`<p style="margin:0">Certaines modifications n'ont pas pu être enregistrées sur le Mac (${Object.keys(pend).length}). Je n'arrête rien pour ne rien perdre. Vérifie la connexion, puis réessaie.</p>`);return}
  try{await api("POST","/api/shutdown")}catch(e){if(e.status===401)return}
  ls.del(qKey());
  document.body.classList.remove("focus");closeDrawer();
  $("#root").innerHTML=`<div class="gate"><div class="panel"><div class="brand"><div class="brand-mark">A</div><b>Apo aventure</b></div><h1>Apo aventure est arrêté</h1><p style="margin:0">Tout est enregistré dans le dossier « Documents / Apo aventure » du Mac.</p><p class="muted" style="margin:0">Pour relancer : double-clic sur « Démarrer Apo aventure » dans Applications / Apo aventure, ou redémarre le Mac. Puis recharge cette page.</p><button class="btn" onclick="location.reload()">Recharger</button></div></div>`;
}

/* ================= TIROIR, TOAST ================= */
function openDrawer(t,html){$("#dTitle").textContent=t;$("#dBody").innerHTML=html;$("#drawer").classList.add("on");$("#scrim").classList.add("on")}
function closeDrawer(){$("#drawer").classList.remove("on");$("#scrim").classList.remove("on");CF=null}
let toastT;function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toastT);toastT=setTimeout(()=>e.classList.remove("on"),2600)}
function moreSheet(){
  openDrawer("Plus",`<div class="list">${["personnages","chronologie","lieux","matrice","lecture","idees","recherche","reglages"].map(k=>`<button class="row" style="border-left:0;border-right:0;border-top:0;background:none;width:100%;text-align:left;min-height:52px" data-go="${k}"><svg viewBox="0 0 24 24" style="width:22px;height:22px;stroke:var(--accent);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round">${ICON[k]}</svg><div class="grow"><b>${VIEWS[k].t}</b></div></button>`).join("")}</div>
  <button class="proj" data-act="projects"><small>Changer de roman</small><span>${esc(DB.projet.titre||"")}</span></button>`);
}

/* ================= ÉVÉNEMENTS ================= */
document.addEventListener("click",async e=>{
  const a=e.target.closest("a[href^='/api/export']");if(a){flushAll();return}
  const t=e.target.closest("[data-go],[data-act],[data-char],[data-char-go],[data-rel],[data-relchar],[data-ev],[data-gs],[data-gc],[data-gmode],[data-gsel],[data-scene],[data-readfrom],[data-pick],[data-statut],[data-ifilter],[data-conv],[data-mention],[data-theme-set],[data-open],[data-color],[data-toggle],[data-tagadd]");
  if(!t)return;
  const d=t.dataset;
  if(d.open){openProject(d.open);return}
  if(d.go){if(d.stop)st.confirm="stop";go(d.go);if(d.stop)setTimeout(()=>$("[data-act=stopApp]")?.scrollIntoView({block:"center"}),50);return}
  if(d.toggle!==undefined){t.setAttribute("aria-pressed",t.getAttribute("aria-pressed")!=="true");return}
  if(d.tagadd){const i=$("#itg");i.value=(i.value?i.value.replace(/,\s*$/,"")+", ":"")+d.tagadd;return}
  if(d.themeSet){if(d.themeSet==="light")delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme="dark";try{localStorage.setItem("apo-theme",d.themeSet)}catch(x){}$$("[data-theme-set]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.themeSet===d.themeSet));return}
  if(d.color){const c=get("personnages",st.charSel);c.couleur=d.color;save("personnages",c,0);render();return}
  if(d.char!==undefined){st.charSel=d.char||null;st.confirm=null;render();window.scrollTo(0,0);return}
  if(d.charGo){st.charSel=d.charGo;st.confirm=null;go("personnages");return}
  if(d.rel){openRel(d.rel);return}
  if(d.relchar){st.relChar=d.relchar;render();return}
  if(d.ev){evForm(get("evenements",d.ev));return}
  if(d.gs){if(st.justDragged)return;st.gSel={k:"s",id:d.gs};if(st.view!=="graphe")go("graphe");else{render();if(isMobile())openDrawer(sceneT(d.gs),gPanel())}return}
  if(d.gc){st.gSel={k:"c",id:d.gc};if(st.view!=="graphe"){go("graphe")}else{render();if(isMobile())openDrawer("Choix",gPanel())}return}
  if(d.gsel){st.gSel={k:"s",id:d.gsel};go("graphe");return}
  if(d.gmode){st.gMode=d.gmode;render();return}
  if(d.scene){st.edScene=d.scene;st.confirm=null;go("scene");return}
  if(d.readfrom){startRead(d.readfrom);go("lecture");return}
  if(d.pick){pick(d.pick);return}
  if(d.statut){const s=get("scenes",st.edScene);s.statut=d.statut;save("scenes",s,0);render();return}
  if(d.ifilter){st.ideaFilter=d.ifilter;render();return}
  if(d.conv){const i=get("idees",d.conv);i.tri=false;save("idees",i,0);
    if(d.to==="scene"){const s=save("scenes",{titre:i.texte.slice(0,48),chap:1,statut:"idee",persos:[],texte:i.texte},0);st.edScene=s.id;go("scene");toast("Scène créée à partir de l'idée.")}
    else if(d.to==="ev"){go("chronologie");evForm(null);$("#eT").value=i.texte.slice(0,60);$("#eD").value=i.texte}
    else render();return}
  if(d.mention){const ta=$("#edText"),p=ta.selectionStart,b=ta.value.slice(0,p).replace(/@[\wÀ-ÿ'-]*$/,d.mention);ta.value=b+ta.value.slice(p);ta.focus();ta.selectionStart=ta.selectionEnd=b.length;$("#mpop").hidden=true;const s=get("scenes",st.edScene);s.texte=ta.value;
    if(d.mid&&!(s.persos||[]).includes(d.mid)){s.persos=[...(s.persos||[]),d.mid];toast(d.mention+" ajouté aux personnages de la scène.")}
    if(d.mlieu&&!s.lieu){s.lieu=d.mlieu;toast("Lieu de la scène : "+d.mention)}
    save("scenes",s);const side=$(".ed-side");if(side)side.innerHTML=edSide(s.id);return}
  if(!d.act)return;
  const A=d.act;
  switch(A){
    case"close":closeDrawer();return;
    case"idea":ideaSheet();return;
    case"more":moreSheet();return;
    case"projects":flushAll();closeDrawer();showProjects();return;
    case"newProj":newProjForm(d.parent,false);return;
    case"newSaga":newProjForm(null,true);return;
    case"seedDemo":seedDemo();return;
    case"settingsGlobal":openDrawer("Réglages",`<div class="seg"><button data-theme-set="light" aria-pressed="${!document.documentElement.dataset.theme}">Clair</button><button data-theme-set="dark" aria-pressed="${document.documentElement.dataset.theme==="dark"}">Sombre</button></div><button class="btn" data-act="logout">Se déconnecter sur cet appareil</button><button class="btn danger" data-act="stopApp">Enregistrer et arrêter l'appli</button>`);return;
    case"saveIdea":{const v=$("#it").value.trim();if(!v){$("#it").focus();return}save("idees",{texte:v,tags:$("#itg").value.split(",").map(s=>s.trim()).filter(Boolean),tri:true},0);closeDrawer();toast("Idée enregistrée.");if(["idees","accueil"].includes(st.view))render();return}
    case"delIdea":if(await remove("idees",d.id)){render();toast("Idée supprimée.")}return;
    case"newChar":newChar();return;
    case"askConfirm":st.confirm=d.what;render();return;
    case"noConfirm":st.confirm=null;render();return;
    case"delChar":{const id=d.id;if(await remove("personnages",id)){for(const r of list("relations").filter(r=>r.a===id||r.b===id))await remove("relations",r.id);list("scenes").forEach(s=>{if((s.persos||[]).includes(id)){s.persos=s.persos.filter(p=>p!==id);save("scenes",s)}});st.charSel=null;st.confirm=null;render();toast("Personnage supprimé.")}return}
    case"saveRel":{const [a,b]=d.k.split(">");let r=relObj(a,b);if(!r)r={id:a+"__"+b,a,b,etats:{}};r.etats={...(r.etats||{}),[st.chap]:{type:$("#rt").value,int:+$("#ri").value,note:$("#rn").value}};r.jauge=$("#rj").value;save("relations",r,0);closeDrawer();render();toast(`Relation enregistrée à partir du chapitre ${st.chap}.`);return}
    case"delRelState":{const [a,b]=d.k.split(">");const r=relObj(a,b);delete r.etats[st.chap];closeDrawer();if(!Object.keys(r.etats).length){await remove("relations",r.id)}else save("relations",r,0);render();return}
    case"newRelFor":pickRelTarget();return;
    case"relPickA":st.relChar=d.id;pickRelTarget();return;
    case"newEv":evForm(null);return;
    case"delEv":if(await remove("evenements",d.id)){closeDrawer();render()}return;
    case"newLieu":prompt2("Nom du lieu",nom=>{save("lieux",{nom,description:""},0);render()});return;
    case"delLieu":if(await remove("lieux",d.id)){list("scenes").forEach(s=>{if(s.lieu===d.id){s.lieu="";save("scenes",s)}});render()}return;
    case"newScene":newScene();return;
    case"setStart":DB.projet.depart=d.id;saveProjet();render();toast("Cette scène est maintenant le début.");return;
    case"relayout":list("scenes").forEach(s=>{if(typeof s.x==="number"){delete s.x;delete s.y;save("scenes",s,1500)}});render();return;
    case"addChoice":choiceForm(null,d.id);return;
    case"editChoice":choiceForm(get("choix",d.id));return;
    case"cAdd":CF.sync();const v0=vars()[0];CF.c.cond.push(v0.type==="drapeau"?[v0.id,"=",true]:[v0.id,">=",1]);CF.draw();return;
    case"cDel":CF.sync();CF.c.cond.splice(+d.i,1);CF.draw();return;
    case"delChoice":if(await remove("choix",d.id)){closeDrawer();st.gSel=null;render()}return;
    case"newVar":varForm(null);return;
    case"editVar":varForm(get("variables",d.id));return;
    case"delVar":{const id=d.id;if(await remove("variables",id)){list("choix").forEach(c=>{const b=JSON.stringify(c);c.cond=(c.cond||[]).filter(x=>x[0]!==id);c.eff=(c.eff||[]).filter(x=>x[0]!==id);if(JSON.stringify(c)!==b)save("choix",c,0)});closeDrawer();render()}return}
    case"togglePerso":{const s=get("scenes",st.edScene);const ps=s.persos||[];s.persos=ps.includes(d.id)?ps.filter(p=>p!==d.id):[...ps,d.id];save("scenes",s,0);const side=$(".ed-side");if(side&&!isMobile())side.innerHTML=edSide(s.id);else $("#dBody").innerHTML=edSide(s.id);return}
    case"delScene":{const id=d.id;for(const c of list("choix").filter(c=>c.de===id))await remove("choix",c.id);if(await remove("scenes",id)){if(DB.projet.depart===id){DB.projet.depart="";saveProjet()}st.edScene=null;st.confirm=null;closeDrawer();render();toast("Scène supprimée (gardée dans la corbeille du projet).")}return}
    case"history":showHistory(d.id);return;
    case"showVer":{const r=await api("GET",`/api/history?path=${encodeURIComponent(PATH)}&id=${d.id}&v=${encodeURIComponent(d.v)}`);$("#verBox").innerHTML=`<div class="lbl" style="margin-top:12px">Version du ${esc(t.textContent)}</div><div class="diff">${esc(r.texte)}</div><button class="btn primary" style="margin-top:10px" data-act="restoreVer" data-id="${d.id}">Restaurer cette version</button>`;VER=r.texte;return}
    case"restoreVer":{const s=get("scenes",d.id);s.texte=VER;save("scenes",s,0);closeDrawer();render();toast("Version restaurée. L'ancienne est gardée dans l'historique.");return}
    case"edSide":openDrawer("Fiches et choix",edSide(st.edScene));return;
    case"focus":document.body.classList.toggle("focus");return;
    case"restart":startRead();render();return;
    case"back":{const r=st.read;const p=JSON.parse(r.hist.pop());Object.assign(r,p,{last:{}});render();return}
    case"txt+":case"txt-":{const cur=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size"))||1.06;const n=Math.max(.9,Math.min(1.6,cur+(A==="txt+"?.08:-.08)));document.documentElement.style.setProperty("--text-size",n.toFixed(2)+"rem");try{localStorage.setItem("apo-text",n.toFixed(2)+"rem")}catch(x){}toast("Taille du texte : "+Math.round(n/1.06*100)+" %");return}
    case"saveProj":Object.assign(DB.projet,{titre:$("#pT").value,genre:$("#pG").value,resume:$("#pR").value,chapitres:Math.max(1,+$("#pC").value||1)});saveProjet();st.chap=Math.min(st.chap,nChap());render();toast("Projet enregistré.");return;
    case"editProj":go("reglages");return;
    case"changeCode":{const c=$("#nc").value;try{await api("POST","/api/setup",{code:c});toast("Code changé.");$("#nc").value=""}catch(x){toast(x.message)}return}
    case"stopApp":stopApp();return;
    case"logout":await api("POST","/api/logout").catch(()=>{});location.reload();return;
    case"keepMine":{const k=d.coll+"/"+d.id;const o=get(d.coll,d.id);pend[k]={coll:d.coll,id:d.id,seq:1,force:true};closeDrawer();flush(k);toast("Ta version est gardée.");return}
    case"takeTheirs":{const th=CONFLICTS[d.coll+"/"+d.id];const o=get(d.coll,d.id);if(th){Object.keys(o).forEach(k=>delete o[k]);Object.assign(o,th)}closeDrawer();render();toast("L'autre version est reprise.");return}
  }
});
let VER="";
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){if($("#drawer").classList.contains("on"))closeDrawer();else if(document.body.classList.contains("focus"))document.body.classList.remove("focus")}
  if(!DB)return;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();const q=$("#q");if(q&&!isMobile())q.focus();else go("recherche")}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="i"){e.preventDefault();ideaSheet()}
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="s"){e.preventDefault();flushAll();toast("Enregistré.")}
});
window.addEventListener("hashchange",()=>{const h=location.hash.slice(1);if(DB&&h&&h!==st.view)go(h,false)});
let lastM=isMobile();window.addEventListener("resize",()=>{const m=isMobile();if(m!==lastM){lastM=m;if(DB)render()}});
setInterval(()=>{if(document.visibilityState==="visible")refresh()},30000);

/* ================= ROMAN D'EXEMPLE ================= */
async function seedDemo(){
  toast("Création du roman d'exemple…");
  const sg=await api("POST","/api/projects",{titre:"Saga Saint-Aubin (exemple)",type:"saga"});
  const r=await api("POST","/api/projects",{titre:"La Maison des Saules",type:"roman",parent:sg.path,genre:"Romance, policier",resume:"Camille revient à Saint-Aubin pour l'enterrement de sa tante Odile, qui lui lègue une maison et une lettre."});
  await api("PUT","/api/project?path="+encodeURIComponent(r.path),{chapitres:3,depart:"s1"});
  const P=(coll,id,data)=>api("PUT",`/api/obj?path=${encodeURIComponent(r.path)}&coll=${coll}&id=${id}`,{data});
  const C={cam:["Camille Arnaud","Protagoniste (le lecteur)","#7A5CC2","Curieuse, ironique, fuit les conflits.","Répond aux questions par d'autres questions."],lina:["Lina Moreau","Love interest","#C2185B","Chaleureuse, très protectrice de ses secrets.","Cite des livres au lieu de dire ce qu'elle ressent."],theo:["Théo Vasseur","Love interest","#D9703A","Loyal, impulsif, mauvais menteur.","Phrases courtes, tutoie tout le monde."],margot:["Margot Delcour","Rivale","#B98A1F","Calculatrice, charmante en public.","Vouvoie même ses proches quand elle est en colère."],bastien:["Bastien Roy","Allié","#22908A","Lent, méthodique, plus fin qu'il n'en a l'air.","« On verra bien. »"]};
  let o=0;for(const [id,[nom,role,couleur,personnalite,voix]] of Object.entries(C))await P("personnages",id,{nom,role,couleur,personnalite,voix,tags:[],ordre:o++});
  const L={saules:"Maison des Saules",librairie:"Le Marque-Page",port:"Café du Port",commissariat:"Commissariat",quais:"Les quais",grenier:"Grenier des Saules"};
  for(const [id,nom] of Object.entries(L))await P("lieux",id,{nom,description:""});
  const V={aff_lina:["Affinité Lina","jauge",3],aff_theo:["Affinité Théo","jauge",3],conf_bastien:["Confiance Bastien","jauge",2],lettre:["A lu la lettre","drapeau",false],cle:["A la clé du grenier","drapeau",false],mensonge:["A menti à Théo","drapeau",false]};
  for(const [id,[nom,type,depart]] of Object.entries(V))await P("variables",id,{nom,type,depart,max:10});
  const S={s1:["L'enterrement d'Odile",1,"final","",["cam","lina","theo","margot","bastien"],"La pluie tombe en biais sur le cimetière marin. Tu reconnais Théo à sa façon de se tenir trop droit, et la libraire, Lina, qui serre contre elle une enveloppe sans nom.\nMargot, la notaire, te prend le bras. « Il faudra parler de la maison, Camille. Vite. »"],
   s2:["La librairie Le Marque-Page",1,"relu","librairie",["cam","lina"],"La librairie sent le papier humide et la cannelle. Lina pose deux tasses sur le comptoir sans te demander ce que tu veux."],
   s3:["Le café du port",1,"relu","port",["cam","theo"],"Théo commande deux cafés-calva, comme à dix-sept ans. Quand tu sors l'enveloppe trouvée dans le ciré d'Odile, il pâlit."],
   s4:["La lettre d'Odile",2,"brouillon","saules",["cam"],"L'enveloppe porte ton prénom, au crayon. Tu pourrais l'ouvrir. Tu pourrais aussi la jeter au feu."],
   s5:["Dîner sur les quais",2,"brouillon","quais",["cam","lina"],"Le vent est tombé d'un coup. Lina a étalé une nappe à carreaux sur le muret du quai.\n« Camille, il faut que je te dise quelque chose sur ta tante. »"],
   s7:["Le commissariat",2,"brouillon","commissariat",["cam","bastien"],"Le commissaire Roy t'écoute en faisant tourner un cachou dans sa bouche. « Vous avez des preuves ou des intuitions ? »"],
   s8:["Le grenier",2,"brouillon","grenier",["cam"],"La clé tourne mal. Quelqu'un est passé avant toi."],
   s9:["La nuit des Saules",3,"plan","saules",["cam","lina"],""],
   s10:["La confrontation",3,"plan","saules",["cam","lina","theo","margot","bastien"],""],
   f1:["Les Saules à deux",3,"plan","saules",["cam","lina"],"Lina et toi repeignez les volets en bleu.","Fin heureuse avec Lina"],
   f2:["Le phare",3,"idee","",["cam","theo"],"Vous regardez le phare depuis la jetée, sans parler.","Fin heureuse avec Théo"],
   f3:["Le train de 7 h 12",3,"brouillon","",["cam"],"Tu as vendu la maison. Dans le train, tu ouvres enfin les lettres d'Odile.","Fin : repartir seule"]};
  for(const [id,[titre,chap,statut,lieu,persos,texte,fin]] of Object.entries(S))await P("scenes",id,{titre,chap,statut,lieu,persos,texte,fin:fin||""});
  const CH=[["s1","s2","Tu acceptes l'invitation de Lina à la librairie",[],[["aff_lina",2]]],["s1","s3","Tu suis Théo au café du port",[],[["aff_theo",2]]],["s2","s4","Tu fouilles l'arrière-boutique",[],[["cle",true]]],["s2","s5","Tu restes dîner avec Lina",[],[["aff_lina",3]]],["s3","s4","Tu lui confies tes doutes",[],[["aff_theo",1]]],["s3","s7","Tu caches la lettre à Théo",[],[["mensonge",true],["aff_theo",-1]]],["s4","s7","Tu ouvres la lettre et appelles le commissaire",[],[["lettre",true],["conf_bastien",2]]],["s4","s8","Tu montes au grenier avec la clé",[["cle","=",true]],[]],["s5","s7","Tu rentres seule aux Saules",[],[]],["s5","s9","Tu l'embrasses sur le quai",[["aff_lina",">=",6]],[["aff_lina",2]]],["s7","s10","Tu accuses Margot",[["lettre","=",true]],[["conf_bastien",1]]],["s7","f3","Tu abandonnes l'enquête",[],[]],["s9","s10","Au matin, tu affrontes Margot",[],[]],["s10","f1","Tu choisis Lina",[["aff_lina",">=",7]],[]],["s10","f2","Tu choisis Théo",[["aff_theo",">=",6],["mensonge","=",false]],[]],["s10","f3","Tu vends la maison et tu pars",[],[]]];
  let i=0;for(const [de,vers,texte,cond,eff] of CH)await P("choix","c"+(++i),{de,vers,texte,cond,eff,ordre:i});
  const R=[["cam","lina",{1:["attirance",2,"Intriguée par la libraire."],3:["amour",4,"Ne veut plus partir."]}],["lina","cam",{1:["mefiance",2,"Se demande ce que Camille vient chercher."],2:["attirance",3,"Lui confie la lettre."]}],["theo","cam",{1:["amour",3,"Amour d'adolescence jamais avoué."]}],["cam","theo",{1:["amitie",3,"Souvenirs d'enfance."],2:["attirance",3,"Le café du port réveille quelque chose."]}],["margot","cam",{1:["rivalite",3,"Veut la maison."],2:["haine",4,"Cambriole le grenier."]}],["theo","margot",{1:["famille",3,"Demi-sœur."],2:["secret",4,"La couvre."]}],["bastien","margot",{1:["dette",3,"Lui doit une faveur."]}]];
  for(const [a,b,et] of R){const etats={};Object.entries(et).forEach(([c,[type,int,note]])=>etats[c]={type,int,note});await P("relations",a+"__"+b,{a,b,etats,jauge:a==="cam"&&b==="lina"?"aff_lina":a==="cam"&&b==="theo"?"aff_theo":""})}
  const E=[["Enterrement d'Odile","Jour 1, matin",1,["cam","lina","theo","margot","bastien"],"saules","s1",""],["Soirée à la librairie","Jour 1, soir",2,["cam","lina"],"librairie","s2","Branche Lina"],["Café-calva au port","Jour 1, soir",2,["cam","theo"],"port","s3","Branche Théo"],["Cambriolage du grenier","Jour 2, nuit",3,["margot"],"grenier","",""],["Déposition au commissariat","Jour 2, nuit",3,["margot","bastien"],"commissariat","",""]];
  i=0;for(const [titre,quand,ordre,persos,lieu,scene,branche] of E)await P("evenements","e"+(++i),{titre,quand,ordre,persos,lieu,scene,branche,description:""});
  await P("idees","i1",{texte:"Et si le livre qu'Odile achetait chaque jeudi contenait la vraie date de naissance d'Hélène ?",tags:["intrigue"],tri:true});
  openProject(r.path);
}

boot();

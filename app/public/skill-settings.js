export function createSkillSettings({api,action,notice,onImported}){
 const $=id=>document.getElementById(id);let loaded=null,dirty=false,selected='',loading=false;
 function choose(){const entry=loaded?.entries.find(e=>e.term===$('glossaryTerm').value);selected=entry?.term||'';$('glossaryNameField').hidden=true;$('glossaryName').value=entry?.term||'';$('glossaryAliases').value=entry?.aliases.join('、')||'';$('glossaryDefinition').value=entry?.definition||'';dirty=false;}
 function show(data){loaded=data;$('glossaryTerm').replaceChildren(...data.entries.map(e=>new Option(e.term,e.term)));if(data.entries.some(e=>e.term===selected))$('glossaryTerm').value=selected;choose();$('glossaryPath').textContent='解释文件：'+data.file;$('glossaryToggle').title='核对'+data.entries.length+'条术语';}
 async function load(){if(loaded||loading)return;loading=true;try{show(await api('glossary'));}finally{loading=false;}}
 $('glossaryToggle').onclick=()=>{const panel=$('glossaryReview');panel.hidden=!panel.hidden;$('glossaryToggle').setAttribute('aria-expanded',String(!panel.hidden));$('glossaryToggle').textContent=panel.hidden?'核对术语':'收起术语';if(!panel.hidden)void action(load);};
 $('skillImportForm').onsubmit=e=>{e.preventDefault();action(async()=>{const file=$('skillFile').files[0];if(!file)throw Error('请选择Markdown技能文件');if(file.size>256*1024)throw Error('技能文件不能超过256KB');$('importSkill').disabled=true;try{const result=await api('skill-import',{text:await file.text(),name:$('skillImportName').value.trim()});$('skillFile').value='';$('skillImportName').value='';await onImported(result.bot);notice('已导入：'+result.bot.name+'，可在Bot选择中使用');}finally{$('importSkill').disabled=false;}});};
 $('glossaryTerm').onchange=()=>{if(dirty){$('glossaryTerm').value=selected;notice('请先保存当前术语，或点“放弃修改”再切换。');return;}choose();};
 for(const id of ['glossaryName','glossaryAliases','glossaryDefinition'])$(id).oninput=()=>{dirty=true;};
 $('glossarySave').onclick=()=>action(async()=>{if(!loaded)throw Error('请先读取术语文件');$('glossarySave').disabled=true;try{const term=selected||$('glossaryName').value.trim(),data=await api('glossary-entry',{version:loaded.version,originalTerm:selected,term,aliases:$('glossaryAliases').value.split(/[、,，]/).map(s=>s.trim()).filter(Boolean),definition:$('glossaryDefinition').value});selected=term;show(data);notice('术语已保存，QQ解释立即生效');}finally{$('glossarySave').disabled=false;}});
 $('glossaryNew').onclick=()=>{if(dirty){notice('请先保存当前术语，或点“放弃修改”。');return;}selected='';$('glossaryTerm').value='';$('glossaryNameField').hidden=false;$('glossaryName').value='';$('glossaryAliases').value='';$('glossaryDefinition').value='';$('glossaryName').focus();};
 $('glossaryCancel').onclick=()=>{dirty=false;selected='';if(loaded)show(loaded);};
 $('glossaryReload').onclick=()=>action(async()=>{if(dirty)throw Error('请先保存当前术语，或点“放弃修改”。');show(await api('glossary'));});
 return {load};
}

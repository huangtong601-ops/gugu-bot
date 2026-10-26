const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export function createUsageSettings({api,notice,getState}){
 let key='',generation=0;
 return {async load(state){
  const config=state.settings,current=JSON.stringify(config);if(key===current)return;key=current;const token=++generation;
  try{
   const data=await api('usage-config');if(token!==generation)return;
   const host=document.getElementById('usageSettingsPanel');host.replaceChildren();host.append(el('h2','API用量与费用'),el('p','当前模型：'+(data.model||'尚未选择')));
   const form=el('form'),controls=el('div');controls.className='usage-pricing-grid';
   const field=(name,node)=>{const label=el('label',name);label.append(node);controls.append(label);return label;};
   const mode=el('select');mode.add(new Option('自动参考官方单价','auto'));mode.add(new Option('手动填写单价','manual'));mode.value=data.rule.mode;field('计费方式',mode);
   const currency=el('select');currency.add(new Option('人民币 CNY','CNY'));currency.add(new Option('美元 USD','USD'));currency.value=data.rule.currency;field('计费币种',currency);
   const numbers={};for(const [name,title]of [['input','非缓存输入 / 百万token'],['cached','缓存输入 / 百万token'],['output','输出 / 百万token']]){const input=el('input');input.type='number';input.min='0';input.step='any';input.value=data.rule[name]??'';numbers[name]={input,label:field(title,input)};}
   const status=el('p');status.className='hint';status.setAttribute('role','status');
   const draw=()=>{for(const value of Object.values(numbers)){value.label.hidden=mode.value!=='manual';value.input.required=mode.value==='manual';}status.textContent=mode.value==='manual'?'按填写单价计算预估费用':data.price?`当前参考单价：输入 ${data.price.input} / 缓存输入 ${data.price.cached} / 输出 ${data.price.output}（每百万token）`:'当前模型暂无内置单价，请切换手动填写';};
   mode.onchange=draw;currency.onchange=()=>{status.textContent='保存后应用所选币种';};draw();
   const save=el('button','保存计费设置');save.type='submit';form.append(controls,status,save);
   form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{if(JSON.stringify(getState().settings)!==current)throw Error('模型已变化，请重新读取设置');const pricing={mode:mode.value,currency:currency.value};if(mode.value==='manual')for(const [name,{input}]of Object.entries(numbers)){if(input.value.trim()==='')throw Error('请填写完整的三项单价');pricing[name]=Number(input.value);}await api('usage-pricing',{...config,pricing});key='';await this.load(getState());notice('计费设置已保存');}catch(error){notice(error.message);}finally{save.disabled=false;}};
   host.append(form);
  }catch(error){notice(error.message);}
 }};
}

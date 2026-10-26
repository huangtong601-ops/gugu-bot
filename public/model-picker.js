export function createModelPicker(api,notice) {
  const $=id=>document.getElementById(id);
  let providers=[],models=[],generation=0,saved=null;
  function configuration(){return {provider:$('provider').value,baseUrl:$('baseUrl').value,model:$('customModel').value.trim()||$('model').value,apiKey:$('apiKey').value};}
  function options(selected='') {
    $('model').replaceChildren(new Option(models.length?'请选择模型版本':'先获取模型列表，再选择版本',''));
    for(const m of models) {
      const ability=m.vision===true?' · 图片 + 文字':m.vision===false?' · 文字':'';
      $('model').add(new Option(`${m.name}${m.name!==m.id?' / '+m.id:''}${ability}`,m.id));
    }
    if(selected&&!models.some(m=>m.id===selected))$('model').add(new Option(selected,selected));
    $('model').value=selected;
  }
  function hints(){
    const custom=$('provider').value==='custom';
    $('baseUrl').readOnly=!custom;$('customModelLabel').hidden=!custom;$('customModel').disabled=!custom;
    $('model').required=!custom;
    $('providerHint').textContent='';
    $('keyStatus').textContent=saved?.hasKey&&saved.settings.provider===$('provider').value&&saved.settings.baseUrl===$('baseUrl').value?'该服务密钥已在本机保存；留空可沿用。':'请填写 API 密钥；该服务以前保存过时可留空。';
  }
  function invalidate(){generation++;models=[];options();$('modelHint').textContent='请获取当前服务及密钥对应的模型版本。';}
  $('provider').onchange=()=>{invalidate();$('apiKey').value='';$('customModel').value='';$('baseUrl').value=providers.find(p=>p.id===$('provider').value)?.baseUrl||'';hints();};
  $('baseUrl').oninput=()=>{invalidate();hints();};
  $('apiKey').oninput=invalidate;
  $('model').onchange=()=>{if($('model').value)$('customModel').value='';$('modelHint').textContent='';};
  $('customModel').oninput=()=>{if($('customModel').value)$('model').value='';};
  $('loadModels').onclick=async()=>{
    const ticket=++generation,config=configuration();notice('正在获取可用模型版本…');$('loadModels').disabled=true;
    try{const result=await api('models',config);if(ticket!==generation)return;models=result.models;options(models.some(m=>m.id===config.model)?config.model:'');$('modelHint').textContent=`已获取 ${models.length} 个模型版本。`;notice('可用模型列表已更新，请选择后保存。');}
    catch(e){if(ticket===generation){models=[];options();notice(e.message);}}
    finally{$('loadModels').disabled=false;}
  };
  return {
    configuration,
    sync(state){saved=state;generation++;providers=state.providers;models=state.models||[];$('provider').replaceChildren(...providers.map(p=>new Option(p.name,p.id)));$('provider').value=state.settings.provider;$('baseUrl').value=state.settings.baseUrl;$('customModel').value='';options(state.settings.model);hints();},
    clearKey(){ $('apiKey').value=''; }
  };
}

export function createRuntimePicker(api,notice){
 const $=id=>document.getElementById(id);let supported=true,pending=false;
 function draw(info){supported=info.supported!==false;$('qqRuntimeDownload').disabled=!supported||pending;$('qqRuntimeSelect').disabled=!supported||pending;$('qqRuntimePath').value=info.available?info.root||'':'';$('qqRuntimePath').placeholder=info.error||'尚未选择NapCat位置';$('qqRuntimeStatus').textContent=info.error||(info.available?'已检测到NapCat运行环境，点击下方按钮启动。':supported?'下载 Windows Node 运行包并解压，再选择解压后的文件夹。':'请在桌面程序中下载并选择NapCat位置。');}
 async function refresh(){try{draw(await api('qq-runtime'));}catch(e){notice(e.message);}}
 async function run(route){if(pending||!supported)return;pending=true;$('qqRuntimeDownload').disabled=true;$('qqRuntimeSelect').disabled=true;try{const result=await api(route,{});if(route==='qq-runtime-download')notice('已打开NapCat官方发布页，请下载 NapCat.Shell.Windows.Node.zip 并解压。');else if(!result.cancelled){draw(result);notice('NapCat位置已保存，可以启动QQ环境。');}}catch(e){notice(e.message);}finally{pending=false;$('qqRuntimeDownload').disabled=!supported;$('qqRuntimeSelect').disabled=!supported;}}
 $('qqRuntimeDownload').onclick=()=>run('qq-runtime-download');$('qqRuntimeSelect').onclick=()=>run('qq-runtime-select');
 return {refresh};
}

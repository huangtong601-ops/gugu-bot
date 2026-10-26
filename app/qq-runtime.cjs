const fs=require('node:fs'),path=require('node:path');
function isQQNT(file){if(!file||path.basename(file).toLowerCase()!=='qq.exe'||!fs.existsSync(file))return false;const root=path.dirname(file);return fs.existsSync(path.join(root,'resources/app'))||fs.existsSync(path.join(root,'versions'));}
function findPortableQQ(root,depth=3){if(!fs.existsSync(root))return null;const direct=path.join(root,'QQ.exe');if(isQQNT(direct))return direct;if(depth<1)return null;for(const item of fs.readdirSync(root,{withFileTypes:true})){if(!item.isDirectory()||item.isSymbolicLink()||['node_modules','versions','resources','config','logs'].includes(item.name))continue;const found=findPortableQQ(path.join(root,item.name),depth-1);if(found)return found;}return null;}
function nodeRuntime(root){return ['node.exe','index.js','wrapper.node','napcat/napcat.mjs'].every(file=>{try{return fs.statSync(path.join(root,file)).isFile();}catch{return false;}})?{kind:'node',root:path.resolve(root),configRoot:path.join(path.resolve(root),'napcat')}:null;}
function findNodeRuntime(folder,depth=2){
 const direct=nodeRuntime(folder);if(direct)return direct;if(depth<1)return null;
 let entries;try{entries=fs.readdirSync(folder,{withFileTypes:true});}catch{return null;}
 // Allow the folder created when extracting the ZIP, without traversing profiles or dependencies.
 for(const entry of entries.slice(0,150)){if(!entry.isDirectory()||entry.isSymbolicLink()||['node_modules','config','cache','logs','static','versions','resources'].includes(entry.name))continue;const found=findNodeRuntime(path.join(folder,entry.name),depth-1);if(found)return found;}
 return null;
}
function saveRuntimePath(dataDir,selected){const detected=nodeRuntime(selected.root);if(!detected)throw Error('请选择完整解压的 NapCat Windows Node 运行包文件夹');fs.mkdirSync(dataDir,{recursive:true});const file=path.join(dataDir,'napcat-runtime.json');fs.writeFileSync(file+'.tmp',JSON.stringify({root:detected.root}));fs.renameSync(file+'.tmp',file);return detected;}
function runtimePaths(appRoot,dataDir){
 if(dataDir){const file=path.join(dataDir,'napcat-runtime.json');if(fs.existsSync(file)){let stored;try{stored=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('NapCat位置记录无法读取，请重新选择文件夹');}const selected=typeof stored.root==='string'?nodeRuntime(stored.root):null;if(!selected)throw Error('已选择的NapCat文件夹不存在或组件不完整，请重新选择位置');return {...selected,source:'selected'};}}
 const base=path.resolve(appRoot,'../runtime/napcat'),nodeRoot=path.join(base,'node-runtime'),existing=nodeRuntime(nodeRoot);
 return existing?{...existing,source:'existing'}:{kind:'framework',root:path.join(base,'framework'),configRoot:path.join(base,'framework'),source:'existing'};
}
module.exports={isQQNT,findPortableQQ,runtimePaths,findNodeRuntime,saveRuntimePath};

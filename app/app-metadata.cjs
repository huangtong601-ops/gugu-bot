const fs=require('node:fs'),path=require('node:path');
// Packaged builds have a flat app/package.json; source checkouts use the repo root.
module.exports=function appMetadata(root=__dirname){
 for(const dir of [root,path.dirname(root)]){
  let pkg;try{pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(pkg.name!=='pingu-desk'||!/^\d+\.\d+\.\d+$/.test(pkg.version))throw Error('应用版本信息无效');return {version:pkg.version};
 }throw Error('缺少应用版本信息');
};

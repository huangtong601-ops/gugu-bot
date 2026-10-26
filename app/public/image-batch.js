export function validateImageSelection(files){
  if(!files.length)throw Error('请先上传商品图');
  if(files.length>10)throw Error('一次最多选择 10 张图片');
  for(const f of files)if(f.size>7*1024*1024)throw Error(`${f.name} 超过 7MB，请压缩后上传`);
}
// Each original has an independent request and crop coordinate space.
export async function runImageBatch(images,{process,onResult,onProgress,isCurrent=()=>true}){
  const failures=[];let completed=0,added=0,updated=0,duplicates=0,adjusted=0;
  for(let i=0;i<images.length;i++){
    if(!isCurrent())throw Error('图片或期次已更换，请重新识别');
    onProgress?.(i+1,images.length);
    try{
      const result=await process(images[i],i);
      if(!isCurrent())throw Error('图片或期次已更换，请重新识别');
      const stats=await onResult(result,i);completed++;added+=stats?.added??result.products.length;updated+=stats?.updated??0;duplicates+=stats?.duplicates??0;adjusted+=stats?.adjusted??0;
    }catch(e){if(!isCurrent())throw e;failures.push({index:i,name:images[i].name,error:e.message});}
  }
  return {completed,added,updated,duplicates,adjusted,failures};
}

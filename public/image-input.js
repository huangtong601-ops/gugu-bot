import {planImageTiles} from './image-geometry.js';
export async function prepareImageParts(dataUrl,originalUrl,upload){
  const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('图片无法解码，请换一张图片'));img.src=dataUrl;});
  const width=image.naturalWidth,height=image.naturalHeight;
  const tiles=planImageTiles(width,height);
  if(tiles.length===1)return {width,height,parts:[{imageUrl:originalUrl,region:{x:0,y:0,width:1,height:1}}]};
  const parts=[];
  for(const tile of tiles){
    const canvas=document.createElement('canvas');canvas.width=tile.width;canvas.height=tile.height;
    const context=canvas.getContext('2d');if(!context)throw Error('无法处理图片，请重新打开应用');
    context.fillStyle='#fff';context.fillRect(0,0,tile.width,tile.height);
    context.drawImage(image,tile.x,tile.y,tile.width,tile.height,0,0,tile.width,tile.height);
    const result=await upload(canvas.toDataURL('image/jpeg',0.94));
    parts.push({imageUrl:result.url,region:{x:tile.x/width,y:tile.y/height,width:tile.width/width,height:tile.height/height}});
  }
  return {width,height,parts};
}

// Pixel-space slices overlap so small text and products on a seam remain visible.
export function planImageTiles(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('无法读取图片尺寸');
  const long=Math.max(width,height),ratio=long/Math.min(width,height);
  if(long<=4096&&(ratio<=3||long<=2500))return [{x:0,y:0,width,height}];
  // Half-tile overlap gives products up to 1024px a complete view across seams.
  const size=2048,step=1024;
  function positions(length){const list=[0];while(list.at(-1)+size<length){const next=Math.min(list.at(-1)+step,length-size);if(next<=list.at(-1))break;list.push(next);}return list;}
  const xs=positions(width),ys=positions(height);if(xs.length*ys.length>32)throw Error('图片太长，请分成几张后分别上传');
  return ys.flatMap(y=>xs.map(x=>({x,y,width:Math.min(size,width-x),height:Math.min(size,height-y)})));
}
// Expand against the original, not the slice: padding may cross a slice seam.
export function paddedCropBounds(bounds,width,height){
  if(!bounds||!['x','y','width','height'].every(k=>Number.isFinite(bounds[k]))||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  if(bounds.x<0||bounds.y<0||bounds.width<=0||bounds.height<=0||bounds.x+bounds.width>1.001||bounds.y+bounds.height>1.001)return null;
  const px=Math.max(16/width,bounds.width*.14),py=Math.max(16/height,bounds.height*.14);
  const x=Math.max(0,bounds.x-px),y=Math.max(0,bounds.y-py);
  return {x,y,width:Math.min(1,bounds.x+bounds.width+px)-x,height:Math.min(1,bounds.y+bounds.height+py)-y};
}
export function originalBounds(bounds,region){
  if(!bounds||!region||!['x','y','width','height'].every(k=>Number.isFinite(bounds[k])&&Number.isFinite(region[k])))return null;
  if(bounds.x<0||bounds.y<0||bounds.width<=0||bounds.height<=0||bounds.x+bounds.width>1.001||bounds.y+bounds.height>1.001)return null;
  return {x:region.x+bounds.x*region.width,y:region.y+bounds.y*region.height,width:bounds.width*region.width,height:bounds.height*region.height};
}

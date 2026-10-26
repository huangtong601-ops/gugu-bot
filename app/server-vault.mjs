import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export function serverCodec(key){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('服务器主密钥必须为32字节');
 return {
  encrypt(bytes){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('pingu-vault/1'));const body=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([Buffer.from([1]),iv,cipher.getAuthTag(),body]);},
  decrypt(bytes){try{if(bytes.length<29||bytes[0]!==1)throw Error();const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(1,13));decipher.setAAD(Buffer.from('pingu-vault/1'));decipher.setAuthTag(bytes.subarray(13,29));return Buffer.concat([decipher.update(bytes.subarray(29)),decipher.final()]);}catch{throw Error('服务器凭据无法解密，请核对主密钥');}}
 };
}

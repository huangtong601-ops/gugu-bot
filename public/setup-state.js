// Existing installations keep their normal startup, including when QQ is temporarily offline.
export function firstSetupStep(state){
 if(state.onboarding?.completedAt)return null;
 if(!state.hasKey||!state.settings?.model)return 0;
 if(state.onboarding?.startedAt)return 1;
 if(!state.qqSettings?.url)return 1;
 return null;
}
export function validateSetup({hasKey,settings,adminQQ,expectedQQ,identity,online,connected}){
 if(!hasKey||!settings?.model)throw Error('请先保存并验证 API 和模型');
 const admin=String(adminQQ||'').trim(),expected=String(expectedQQ||'').trim();
 if(!/^\d{5,12}$/.test(admin))throw Error('请填写正确的管理员QQ号');
 if(expected&&!/^\d{5,12}$/.test(expected))throw Error('请填写正确的机器人QQ号');
 if(!connected||online!==true||!identity?.user_id)throw Error('请先完成QQ登录并连接机器人');
 const qq=String(identity.user_id);
 if(expected&&expected!==qq)throw Error('当前登录QQ与填写的机器人QQ不一致，请核对账号');
 if(admin===qq)throw Error('管理员QQ应填写你的个人QQ，不能与机器人QQ相同');
 return {admin,qq};
}

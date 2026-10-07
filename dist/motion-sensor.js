// Sensor data is auxiliary only: never integrate acceleration into claimed distance,
// move an image target, or declare successful tracking from motion events.
export class MotionSensor {
  constructor(host=globalThis,now=()=>performance.now()){
    this.host=host;this.now=now;this.enabled=false;this.epoch=0;this.status='off';
    this.listener=e=>{
      const r=e.rotationRate,a=e.acceleration;
      const rate=r&&['alpha','beta','gamma'].every(k=>Number.isFinite(r[k]))?Math.hypot(r.alpha,r.beta,r.gamma):null;
      const acceleration=a&&['x','y','z'].every(k=>Number.isFinite(a[k]))?Math.hypot(a.x,a.y,a.z):null;
      if(rate===null&&acceleration===null)return;
      const portrait=(this.host.screen?.orientation?.angle??this.host.orientation??0)===0;
      const direction=portrait&&rate!==null&&Math.abs(r.beta)>Math.abs(r.gamma)*1.4&&Math.abs(r.beta)>8?(r.beta>0?'正在抬高镜头':'正在压低镜头'):'';
      this.latest={time:this.now(),rate,acceleration,direction};this.status='ready';
    };
  }
  async enable(){
    const token=++this.epoch,api=this.host.DeviceMotionEvent;
    if(!api){this.status='unsupported';return false;}
    this.status='requesting';
    try{
      const result=typeof api.requestPermission==='function'?await api.requestPermission():'granted';
      if(token!==this.epoch)return false;
      if(result!=='granted'){this.status='denied';return false;}
      this.enabled=true;this.start();return true;
    }catch{if(token===this.epoch)this.status='denied';return false;}
  }
  start(){if(!this.enabled)return;this.host.removeEventListener('devicemotion',this.listener);this.latest=null;this.status='waiting';this.host.addEventListener('devicemotion',this.listener);}
  stop(){this.epoch++;this.host.removeEventListener('devicemotion',this.listener);this.latest=null;if(this.enabled)this.status='paused';}
  feedback(action){
    const data=this.latest;if(!data||this.now()-data.time>500)return '';
    if(data.rate>18)return action==='back'?'手机转动较多；尽量保持镜头方向，再缓慢拉开距离。':`${data.direction||'检测到手机正在转动'}，请慢一些；方向以画面箭头为准。`;
    if(data.acceleration>1.2)return '检测到手机在移动；位置是否合适以画面中的主体为准。';
    return '手机动作较稳，继续按画面提示调整。';
  }
}

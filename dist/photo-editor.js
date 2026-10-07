import {looks,outputSize,neutralAdjustments} from './photo-utils.js';
import {styles} from './photo-styles.js';
import {drawCapture} from './camera-renderer.js';
const $=id=>document.getElementById(id),copy=value=>structuredClone(value);
const nextPaint=()=>new Promise(resolve=>setTimeout(resolve,20));

export function setupPhotoEditor({makePhoto}){
  let raw=null,session=0,revision=0,current=null,recommended=null,crops=[],info=null,published=null;
  const filterSelect=$('reviewFilter');filterSelect.replaceChildren(...looks.map(f=>new Option(f.name,f.id)));
  function controls(busy){$('reviewControls').disabled=busy;for(const id of ['shareButton','downloadButton','retouchPhoto'])$(id).disabled=busy;}
  function clear(){session++;revision++;if(raw)raw.width=raw.height=1;raw=null;current=recommended=info=published=null;crops=[];$('reviewColor').hidden=true;$('sourcePreview').removeAttribute('src');$('styleChoices').replaceChildren();$('cropChoices').replaceChildren();controls(false);}
  function write(){
    $('reviewFilter').value=current.filter.id;$('reviewStrength').value=current.filter.strength;$('reviewStrengthValue').textContent=current.filter.strength+'%';
    for(const key of ['exposure','contrast','saturation']){const k=key[0].toUpperCase()+key.slice(1),value=current.adjustments?.[key]||0;$('review'+k).value=value;$('review'+k+'Value').textContent=value;}
    for(const [key,label] of [['subjectEV','SubjectLight'],['backgroundEV','BackgroundLight']]){const value=current.lighting?.[key]||0;$('review'+label).value=value;$('review'+label+'Value').textContent=value;}
    $('reviewLighting').hidden=!current.subjectBox;
    $('reviewRecommend').hidden=!recommended;$('reviewRecommend').textContent=info?.kind==='本地构图'?'恢复本地建议':'恢复 AI 推荐';
    $('reviewReason').textContent=info?.reason||styles.find(s=>s.id===current.filter.id)?.description||'从完整底图重新处理；切换风格不会叠加效果。';
    document.querySelectorAll('#styleChoices [data-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.style===current.filter.id)));
    document.querySelectorAll('#cropChoices [data-crop]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.crop)===info.cropIndex)));
  }
  async function paint(valid=()=>true,initial=false){
    if(!raw)return;const source=raw,id=session,edit=++revision,config=copy(current);
    const active=()=>raw===source&&id===session&&edit===revision&&!document.hidden&&valid();
    controls(true);$('reviewStatus').textContent='正在应用构图与风格…';
    try{
      await nextPaint();if(!active()){if(initial)throw new Error('拍摄已取消。');return;}
      const result=await makePhoto(source,source.width,source.height,{renderOnly:true,crop:false,rect:config.crop,filter:config.filter,adjustments:config.adjustments,lighting:config.lighting,subjectBox:config.subjectBox,kind:info.kind,valid:active});
      if(!active())return;
      published={current:config,info:copy(info)};
      $('reviewStatus').textContent='已应用，可保存。';
      const requested=info.requestedZoom?`${info.kind==='本地构图'?'本地建议':'AI 期望'} ${info.requestedZoom.toFixed(2)}×；拍摄实际 ${info.actualZoom.toFixed(2)}×。${info.adjusted?'为容纳主体或满足画质预算，执行时已调整范围。':''}`:'';
      const local=config.lighting&&(config.lighting.subjectEV||config.lighting.backgroundEV)?(result.locallyAdjusted?'局部光影已应用（按主体区域和像素颜色估计）。':'主体与背景颜色难以区分，已跳过局部光影。'):'局部光影未启用。';
      $('reviewRecipe').textContent=`${requested} 当前保留底图 ${(100*config.crop.sw/source.width).toFixed(0)}% 宽度，${result.width} × ${result.height}；${looks.find(f=>f.id===config.filter.id).name} ${config.filter.strength}%；曝光 ${config.adjustments?.exposure||0} EV。${local}`;
    }catch(error){
      if(active()){
        if(published){current=copy(published.current);info=copy(published.info);write();cropCards();styleCards();}
        $('reviewStatus').textContent=error.message;
      }if(initial)throw error;
    }
    finally{if(id===session&&edit===revision)controls(false);}
  }
  function thumb(config){const c=document.createElement('canvas');drawCapture(raw,c,config,{maxEdge:144});c.setAttribute('aria-hidden','true');return c;}
  function cropCards(){
    $('cropChoices').replaceChildren();
    crops.forEach((choice,index)=>{
      const b=document.createElement('button');b.type='button';b.dataset.crop=index;b.setAttribute('aria-pressed',String(index===info.cropIndex));b.className='photo-choice';b.append(thumb({...current,crop:choice.crop}),document.createTextNode(choice.label));b.title=choice.reason;
      b.onclick=()=>{info.cropIndex=index;info.reason=choice.reason;current.crop=copy(choice.crop);write();styleCards();paint();};$('cropChoices').append(b);
    });
  }
  function styleCards(){
    $('styleChoices').replaceChildren();
    for(const style of [...styles,{id:'original',name:'原片色彩'}]){
      const filter={id:style.id,strength:style.id==='original'?0:85},b=document.createElement('button');b.type='button';b.dataset.style=style.id;b.className='photo-choice';b.title=style.description||'保持当前构图';
      b.append(thumb({...current,filter}),document.createTextNode(style.name));
      b.onclick=()=>{current.filter=filter;info.reason=style.description||'原片色彩；曝光和局部光影可在下方还原。';write();cropCards();paint();};$('styleChoices').append(b);
    }write();
  }
  async function open(source,width,height,options={}){
    clear();const id=session,valid=options.valid||(()=>true),size=outputSize(width,height);
    raw=document.createElement('canvas');raw.width=size.width;raw.height=size.height;
    const ctx=raw.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,raw.width,raw.height);if(options.mirrored){ctx.translate(raw.width,0);ctx.scale(-1,1);}ctx.drawImage(source,0,0,raw.width,raw.height);ctx.resetTransform();
    const sx=raw.width/(options.sourceWidth||width),sy=raw.height/(options.sourceHeight||height);
    const rect=r=>({sx:r.sx*sx,sy:r.sy*sy,sw:r.sw*sx,sh:r.sh*sy});
    const b=options.subjectBox;
    const full={sx:0,sy:0,sw:raw.width,sh:raw.height};
    current={crop:options.rect?rect(options.rect):full,mirrored:false,filter:copy(options.filter||{id:'original',strength:0}),adjustments:copy(options.adjustments||neutralAdjustments()),lighting:copy(options.lighting||{subjectEV:0,backgroundEV:0}),subjectBox:b?{x:b.x*sx,y:b.y*sy,width:b.width*sx,height:b.height*sy}:null};
    if(current.filter.id==='original')current.filter.strength=0;
    crops=(options.crops||[{label:'拍摄构图',reason:'保留拍摄时的取景。',crop:options.rect||{sx:0,sy:0,sw:width,sh:height}}]).map(c=>({...c,crop:rect(c.crop)}));
    const fullIndex=crops.findIndex(c=>Math.abs(c.crop.sw-full.sw)+Math.abs(c.crop.sh-full.sh)<2);
    if(fullIndex<0)crops.push({label:'完整底图',reason:'保留拍摄时的完整画面，可重新选择构图。',crop:full});else crops[fullIndex].label='完整底图';
    info={kind:options.kind||'拍摄',reason:options.reason,...options.diagnostics,cropIndex:0};
    recommended=options.recommended?copy(current):null;
    $('reviewColor').hidden=false;$('beforeAfter').open=false;
    const before=document.createElement('canvas');drawCapture(raw,before,{crop:full,filter:{id:'original',strength:0}},{maxEdge:720});$('sourcePreview').src=before.toDataURL('image/jpeg',.9);before.width=before.height=1;
    write();cropCards();styleCards();
    try{await paint(()=>id===session&&valid(),true);}catch(error){if(id===session)clear();throw error;}
    if(id===session&&!valid()){clear();throw new Error('拍摄已取消。');}
  }
  function read(){
    current.filter={id:$('reviewFilter').value,strength:Number($('reviewStrength').value)};if(current.filter.id==='original')current.filter.strength=0;
    current.adjustments={exposure:Number($('reviewExposure').value),contrast:Number($('reviewContrast').value),saturation:Number($('reviewSaturation').value)};
    current.lighting={subjectEV:Number($('reviewSubjectLight').value),backgroundEV:Number($('reviewBackgroundLight').value)};
  }
  for(const suffix of ['Strength','Exposure','Contrast','Saturation','SubjectLight','BackgroundLight'])$('review'+suffix).onchange=()=>{read();write();cropCards();styleCards();paint();};
  filterSelect.onchange=()=>{if(filterSelect.value!=='original'&&Number($('reviewStrength').value)===0)$('reviewStrength').value=85;read();info.reason=styles.find(s=>s.id===current.filter.id)?.description;write();cropCards();paint();};
  $('reviewReset').onclick=()=>{current.filter={id:'original',strength:0};current.adjustments=neutralAdjustments();current.lighting={subjectEV:0,backgroundEV:0};info.reason='色彩和光影已还原，保留当前构图。';write();cropCards();styleCards();paint();};
  $('reviewRecommend').onclick=()=>{if(!recommended)return;current=copy(recommended);info.cropIndex=0;info.reason=crops[0].reason;write();cropCards();styleCards();paint();};
  function cancelEdit(){revision++;controls(false);if(published&&raw){current=copy(published.current);info=copy(published.info);write();cropCards();styleCards();$('reviewStatus').textContent='已保留上次完成的成片。';}}
  $('photoDialog').addEventListener('close',cancelEdit);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelEdit();});
  window.addEventListener('pagehide',clear);
  return {open,clear};
}

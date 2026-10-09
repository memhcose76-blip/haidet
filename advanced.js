'use strict';
(() => {
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const app = window.PrinovaApp;
  if (!app) { console.error('PRINOVA editor core is unavailable.'); return; }

  const state = { scanSrc:null, resultSrc:null, stream:null, cvPromise:null, textCardId:null };
  const presets = {
    id:{w:85.6,h:53.98,label:'البطاقة الوطنية'},
    idPortrait:{w:53.98,h:85.6,label:'البطاقة الوطنية'},
    residence:{w:105,h:148,label:'بطاقة السكن'},
    residenceLandscape:{w:148,h:105,label:'بطاقة السكن'},
    passport:{w:35,h:45,label:'صورة جواز'}
  };
  const modal = id => $('#'+id);
  const show = id => app.openModal(modal(id));
  const hide = id => app.closeModal(modal(id));
  const selected = () => app.getSelected();

  function setStatus(message, kind='') {
    const el=$('#scanStatus'); el.textContent=message; el.className='scanner-note'+(kind?' '+kind:'');
  }
  function setScanPreview(src) {
    const img=$('#scanImage'), video=$('#scanVideo'), placeholder=$('#scanPlaceholder');
    img.src=src; img.hidden=false; video.hidden=true; placeholder.hidden=true;
  }
  function readFile(file) {
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('تعذرت قراءة الصورة'));r.readAsDataURL(file)});
  }
  function stopCamera() {
    if(state.stream){state.stream.getTracks().forEach(track=>track.stop());state.stream=null;}
    const v=$('#scanVideo'); if(v.srcObject){v.srcObject=null;} $('#captureBtn').disabled=true;
  }
  function resetScanner() {
    stopCamera();state.scanSrc=null;state.resultSrc=null;
    $('#scanImage').hidden=true;$('#scanVideo').hidden=true;$('#scanPlaceholder').hidden=false;
    $('#detectScan').disabled=true;$('#addScanResult').disabled=true;
    $('#scanResultCanvas').hidden=true;
    setStatus('المعالجة داخل جهازك. الكشف وتصحيح المنظور داخل جهازك بدون رفع الصور.');
  }
  $('#scanBtn').addEventListener('click',()=>{resetScanner();show('scannerModal')});
  $('#cameraBtn').addEventListener('click',async()=>{
    if(!navigator.mediaDevices?.getUserMedia){setStatus('المتصفح لا يدعم الكاميرا؛ استخدم اختيار صورة.','error');return;}
    try{
      stopCamera();state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:2560},height:{ideal:1920}},audio:false});
      const video=$('#scanVideo');video.srcObject=state.stream;video.hidden=false;$('#scanImage').hidden=true;$('#scanPlaceholder').hidden=true;await video.play();
      $('#captureBtn').disabled=false;state.scanSrc=null;state.resultSrc=null;$('#detectScan').disabled=true;$('#addScanResult').disabled=true;setStatus('الكاميرا جاهزة. ثبّت الهاتف واجعل الحواف الأربع ظاهرة.','success');
    }catch(e){setStatus('ما گدرت أفتح الكاميرا. تأكد من إذن الكاميرا، أو اختَر صورة من الجهاز.','error');}
  });
  $('#captureBtn').addEventListener('click',()=>{
    const video=$('#scanVideo');if(!video.videoWidth)return;
    const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);
    state.scanSrc=c.toDataURL('image/jpeg',.94);state.resultSrc=null;setScanPreview(state.scanSrc);stopCamera();$('#detectScan').disabled=false;$('#addScanResult').disabled=false;setStatus('تم التقاط الصورة. شغّل كشف وتصحيح الحدود.');
  });
  $('#scanFileBtn').addEventListener('click',()=>$('#scanFile').click());
  $('#scanFile').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{state.scanSrc=await readFile(file);state.resultSrc=null;setScanPreview(state.scanSrc);$('#detectScan').disabled=false;$('#addScanResult').disabled=false;setStatus('تم تحميل الصورة إلى المتصفح. الصور لا تغادر جهازك.','success');}
    catch{setStatus('تعذرت قراءة هذه الصورة.','error');}finally{e.target.value='';}
  });
  $('#closeScanner').addEventListener('click',stopCamera);
  modal('scannerModal').addEventListener('click',e=>{if(e.target===modal('scannerModal'))stopCamera()});
  $('#edgeLevel').addEventListener('input',()=>$('#edgeLevelOut').textContent=$('#edgeLevel').value);

  function orderedCorners(points) {
    const cx=points.reduce((s,p)=>s+p.x,0)/4,cy=points.reduce((s,p)=>s+p.y,0)/4;
    const p=[...points].sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));
    let first=0;for(let i=1;i<4;i++)if(p[i].x+p[i].y<p[first].x+p[first].y)first=i;
    const out=p.slice(first).concat(p.slice(0,first));
    if(out[1].x<out[3].x)return [out[0],out[3],out[2],out[1]];
    return out;
  }
  function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
  function aspectOfQuad(p){return Math.max(distance(p[0],p[1]),distance(p[2],p[3]))/Math.max(1,Math.max(distance(p[1],p[2]),distance(p[3],p[0])))}
  function targetRatio(type, detected) {
    if(type==='auto')return detected;
    const m=presets[type];return m?m.w/m.h:detected;
  }
  async function imageSourceCanvas(source) {
    let img=source;if(typeof source==='string')img=await app.loadImage(source);
    const width=img.videoWidth||img.naturalWidth||img.width,height=img.videoHeight||img.naturalHeight||img.height;
    if(!width||!height)throw Error('الصورة غير جاهزة');
    const max=2600,scale=Math.min(1,max/Math.max(width,height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    canvas.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,canvas.width,canvas.height);return canvas;
  }
  function detectQuadrilateral(imageCanvas) {
    const maxDetect=900,scale=Math.min(1,maxDetect/Math.max(imageCanvas.width,imageCanvas.height)),small=document.createElement('canvas');
    small.width=Math.max(1,Math.round(imageCanvas.width*scale));small.height=Math.max(1,Math.round(imageCanvas.height*scale));
    const ctx=small.getContext('2d',{willReadFrequently:true});ctx.drawImage(imageCanvas,0,0,small.width,small.height);
    const {data}=ctx.getImageData(0,0,small.width,small.height),w=small.width,h=small.height,gray=new Uint8Array(w*h);
    for(let i=0,p=0;i<gray.length;i++,p+=4)gray[i]=Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2]);
    const edgeLevel=+$('#edgeLevel').value||65,threshold=35+edgeLevel*.62,points=[];
    const at=(x,y)=>gray[y*w+x];
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const gx=-at(x-1,y-1)+at(x+1,y-1)-2*at(x-1,y)+2*at(x+1,y)-at(x-1,y+1)+at(x+1,y+1);
      const gy=-at(x-1,y-1)-2*at(x,y-1)-at(x+1,y-1)+at(x-1,y+1)+2*at(x,y+1)+at(x+1,y+1);
      const mag=Math.hypot(gx,gy);if(mag<threshold)continue;
      if(points.length>36000&&((x+y)&1))continue;
      let angle=Math.round(Math.atan2(gy,gx)*180/Math.PI);angle=(angle%180+180)%180;
      points.push({x,y,angle,weight:mag>500?2:1});
    }
    if(points.length<80)throw Error('الحواف مو واضحة كفاية');
    const diag=Math.hypot(w,h),rhoBins=Math.ceil(diag/2)*2+1,acc=new Uint32Array(180*rhoBins),cos=new Float32Array(180),sin=new Float32Array(180);
    for(let t=0;t<180;t++){const rad=t*Math.PI/180;cos[t]=Math.cos(rad);sin[t]=Math.sin(rad)}
    for(const p of points){for(let d=-7;d<=7;d++){const t=(p.angle+d+180)%180,r=Math.round((p.x*cos[t]+p.y*sin[t]+diag)/2);if(r>=0&&r<rhoBins)acc[t*rhoBins+r]+=p.weight}}
    const minVotes=Math.max(18,Math.round(Math.min(w,h)*.085)),raw=[];
    for(let t=0;t<180;t++)for(let r=2;r<rhoBins-2;r++){
      const v=acc[t*rhoBins+r];if(v<minVotes)continue;let peak=true;
      for(let dt=-2;dt<=2&&peak;dt++)for(let dr=-4;dr<=4;dr++){
        if(!dt&&!dr)continue;const nt=(t+dt+180)%180,nr=r+dr,nv=acc[nt*rhoBins+nr];if(nv>v||(nv===v&&(nt<t||(nt===t&&nr<r)))){peak=false;break}
      }
      if(peak)raw.push({theta:t*Math.PI/180,rho:r*2-diag,votes:v});
    }
    raw.sort((a,b)=>b.votes-a.votes);const lines=[];
    for(const line of raw){if(lines.some(q=>{const da=Math.abs(line.theta-q.theta)*180/Math.PI,d=Math.min(da,180-da);return d<5&&Math.abs(line.rho-q.rho)<14}))continue;lines.push(line);if(lines.length>=22)break}
    if(lines.length<4)throw Error('ما انوجدت أربع حواف مستقيمة واضحة');
    const angleDiff=(a,b)=>{const d=Math.abs(a-b)*180/Math.PI;return Math.min(d,180-d)};
    const intersection=(a,b)=>{const det=cos[Math.round(a.theta*180/Math.PI)%180]*sin[Math.round(b.theta*180/Math.PI)%180]-sin[Math.round(a.theta*180/Math.PI)%180]*cos[Math.round(b.theta*180/Math.PI)%180];if(Math.abs(det)<.18)return null;const ca=Math.cos(a.theta),sa=Math.sin(a.theta),cb=Math.cos(b.theta),sb=Math.sin(b.theta);return{x:(a.rho*sb-sa*b.rho)/det,y:(ca*b.rho-a.rho*cb)/det}};
    let best=null,bestScore=-Infinity;
    for(let i=0;i<lines.length-3;i++)for(let j=i+1;j<lines.length-2;j++)for(let k=j+1;k<lines.length-1;k++)for(let l=k+1;l<lines.length;l++){
      const q=[lines[i],lines[j],lines[k],lines[l]],parts=[[0,1,2,3],[0,2,1,3],[0,3,1,2]];
      for(const [a,b,c,d] of parts){const pA=q[a],pB=q[b],pC=q[c],pD=q[d],da=angleDiff(pA.theta,pB.theta),db=angleDiff(pC.theta,pD.theta),cross=angleDiff((pA.theta+pB.theta)/2,(pC.theta+pD.theta)/2);if(da>31||db>31||cross<38||cross>142)continue;
        const points=[intersection(pA,pC),intersection(pB,pC),intersection(pB,pD),intersection(pA,pD)];if(points.some(x=>!x))continue;
        const ordered=orderedCorners(points);if(ordered.some(p=>p.x< -8||p.y< -8||p.x>w+8||p.y>h+8))continue;
        const area=Math.abs(ordered.reduce((sum,p,n)=>sum+p.x*ordered[(n+1)%4].y-p.y*ordered[(n+1)%4].x,0)/2),fraction=area/(w*h);if(fraction<.065||fraction>.985)continue;
        const ratio=aspectOfQuad(ordered);if(ratio<.32||ratio>3.1)continue;
        const score=area*(pA.votes+pB.votes+pC.votes+pD.votes)/(1+(da+db)*.025);
        if(score>bestScore){bestScore=score;best={points:ordered.map(p=>({x:p.x/scale,y:p.y/scale})),areaRatio:fraction,detectedRatio:ratio}}
      }
    }
    if(!best)throw Error('ما انكشفت حدود مستطيلة واضحة؛ جرّب إضاءة أفضل وخلفية متباينة');
    return best;
  }
  function solveProjective(source,dest) {
    const matrix=[];
    for(let i=0;i<4;i++){
      const {x:u,y:v}=dest[i],{x,y}=source[i];
      matrix.push([u,v,1,0,0,0,-x*u,-x*v,x]);
      matrix.push([0,0,0,u,v,1,-y*u,-y*v,y]);
    }
    for(let col=0;col<8;col++){
      let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
      if(Math.abs(matrix[pivot][col])<1e-10)throw Error('تعذر تصحيح منظور الصورة');
      [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];const div=matrix[col][col];for(let j=col;j<9;j++)matrix[col][j]/=div;
      for(let row=0;row<8;row++){if(row===col)continue;const factor=matrix[row][col];for(let j=col;j<9;j++)matrix[row][j]-=factor*matrix[col][j]}
    }
    return matrix.map(row=>row[8]);
  }
  async function rectifyImage(source,type='auto') {
    const original=await imageSourceCanvas(source),found=detectQuadrilateral(original),ratio=targetRatio(type,found.detectedRatio),longSide=Math.min(1800,Math.sqrt(5_000_000/Math.max(ratio,1/ratio)));
    const outW=Math.round(ratio>=1?longSide:longSide*ratio),outH=Math.round(ratio>=1?longSide/ratio:longSide),input=original.getContext('2d',{willReadFrequently:true}).getImageData(0,0,original.width,original.height),output=document.createElement('canvas');
    output.width=outW;output.height=outH;const ctx=output.getContext('2d'),out=ctx.createImageData(outW,outH),dstPts=[{x:0,y:0},{x:outW-1,y:0},{x:outW-1,y:outH-1},{x:0,y:outH-1}],h=solveProjective(found.points,dstPts),src=input.data,d=out.data,sw=original.width,sh=original.height;
    for(let y=0;y<outH;y++)for(let x=0;x<outW;x++){
      const z=h[6]*x+h[7]*y+1,sx=(h[0]*x+h[1]*y+h[2])/z,sy=(h[3]*x+h[4]*y+h[5])/z,dx=Math.max(0,Math.min(sw-1,sx)),dy=Math.max(0,Math.min(sh-1,sy)),x0=Math.floor(dx),y0=Math.floor(dy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1),fx=dx-x0,fy=dy-y0,di=(y*outW+x)*4,i00=(y0*sw+x0)*4,i10=(y0*sw+x1)*4,i01=(y1*sw+x0)*4,i11=(y1*sw+x1)*4;
      for(let c=0;c<4;c++){const a=src[i00+c]*(1-fx)+src[i10+c]*fx,b=src[i01+c]*(1-fx)+src[i11+c]*fx;d[di+c]=a*(1-fy)+b*fy}
    }
    ctx.putImageData(out,0,0);return{dataURL:output.toDataURL('image/png'),ratio:outW/outH,detectedRatio:found.detectedRatio,areaRatio:found.areaRatio,corners:found.points,width:outW,height:outH};
  }
  function classify(ratio) {
    if(Math.abs(ratio-(85.6/53.98))<.22)return 'id';
    if(Math.abs(ratio-(53.98/85.6))<.1)return 'idPortrait';
    if(Math.abs(ratio-(105/148))<.13)return 'residence';
    if(Math.abs(ratio-(148/105))<.2)return 'residenceLandscape';
    return null;
  }

  $('#detectScan').addEventListener('click',async()=>{
    if(!state.scanSrc)return;$('#detectScan').disabled=true;setStatus('أحلّل الحواف والزوايا محلياً…');
    try{
      const result=await rectifyImage(state.scanSrc,$('#scanType').value);state.resultSrc=result.dataURL;
      setScanPreview(state.resultSrc);$('#addScanResult').disabled=false;
      const detected=classify(result.detectedRatio),label=detected?presets[detected].label:'بطاقة أو مستند';
      setStatus(`تم كشف حدود ${label} وتصحيح ميل الصورة. الناتج ${result.width} × ${result.height} بكسل؛ المعالجة على جهازك.`,'success');
    }catch(e){state.resultSrc=null;setScanPreview(state.scanSrc);setStatus(`${e.message||'تعذر اكتشاف الحدود'}. تقدر تضيف الصورة وتقصها يدوياً، أو جرّب إضاءة وخلفية متباينة أكثر.`,'error');}
    finally{$('#detectScan').disabled=false;}
  });
  $('#addScanResult').addEventListener('click',async()=>{
    const src=state.resultSrc||state.scanSrc;if(!src)return;
    stopCamera();hide('scannerModal');
    try{
      const card=await app.addImageData(src,state.resultSrc?'مسح-مصحح.png':'مسح-يدوي.png');
      const resultImg=state.resultSrc?await app.loadImage(src):null,type=state.resultSrc?($('#scanType').value==='auto'?classify(resultImg.naturalWidth/resultImg.naturalHeight):$('#scanType').value):null;
      if(type&&presets[type]){const p=presets[type],st=app.state;card.mmW=p.w;card.mmH=p.h;card.w=p.w/st.paper.w*100;card.h=p.h/st.paper.h*100;card.x=Math.max(0,Math.min(card.x,100-card.w));card.y=Math.max(0,Math.min(card.y,100-card.h));}
      app.render();app.persist();app.toast(state.resultSrc?'انضافت البطاقة بعد التصحيح':'انضافت الصورة؛ حدّدها واستخدم أداة القص');
      if(!state.resultSrc){setTimeout(()=>document.querySelector('[data-action="crop"]')?.click(),250);}
    }catch{app.toast('تعذر إضافة الصورة الممسوحة');}
  });

  async function detectAddedCards(cards) {
    const candidates=cards.filter(c=>c.src);if(!candidates.length)return;
    app.toast('أفحص الصور لاكتشاف حدود البطاقة محلياً…');
    try{
      let changed=0;
      for(const card of candidates){
        try{
          const r=await rectifyImage(card.src,'auto'),type=classify(r.detectedRatio);
          if(!type||r.areaRatio>.92)continue;
          app.snapshot();card.src=r.dataURL;card.originalSrc=r.dataURL;card.detectedCard=type;card.mmW=presets[type].w;card.mmH=presets[type].h;
          const st=app.state;card.w=card.mmW/st.paper.w*100;card.h=card.mmH/st.paper.h*100;card.x=Math.max(0,Math.min(card.x,100-card.w));card.y=Math.max(0,Math.min(card.y,100-card.h));changed++;
        }catch{}
      }
      if(changed){app.render();app.persist();app.toast(`تم كشف وتصحيح ${changed} بطاقة تلقائياً. تقدر تعدّل الإطار أو القياس.`)}
      else app.toast('ما ظهر حد بطاقة واضح؛ استخدم الماسح أو قصّ الصورة يدوياً.');
    }catch{app.toast('ما انكشفت حدود بطاقة واضحة؛ جرّب تبايناً وإضاءة أفضل أو استخدم القص اليدوي.')}
  }

  // Preset looks are CSS-only; they remain editable and are also applied during export.
  $('#filtersBtn').addEventListener('click',()=>{
    if(!selected()){app.toast('اختار صورة أولاً حتى تطبق الفلتر');return;}
    const look=selected().look||'';$$('#filterGrid button').forEach(b=>b.classList.toggle('active',b.dataset.look===look));show('filtersModal');
  });
  $('#filterGrid').addEventListener('click',e=>{
    const b=e.target.closest('[data-look]');if(!b)return;const c=selected();if(!c){app.toast('اختار صورة أولاً');return;}
    app.snapshot();c.look=b.dataset.look;app.render();app.persist();$$('#filterGrid button').forEach(x=>x.classList.toggle('active',x===b));app.toast(`تم تطبيق فلتر ${b.querySelector('b')?.textContent||'الصورة'}`);
  });

  // Physical measurement controls for national-ID and residence-card layouts.
  $('#sizeBtn').addEventListener('click',()=>{
    const c=selected();if(!c){app.toast('اختار صورة حتى تحدد قياسها');return;}
    $('#photoW').value=c.mmW||85.6;$('#photoH').value=c.mmH||53.98;$('#photoUnit').value='mm';show('sizeModal');
  });
  $$('.size-presets button').forEach(b=>b.addEventListener('click',()=>{
    $('#photoW').value=b.dataset.w;$('#photoH').value=b.dataset.h;$('#photoUnit').value='mm';
    $$('.size-presets button').forEach(x=>x.classList.toggle('active',x===b));
  }));
  $('#applyPhotoSize').addEventListener('click',()=>{
    const c=selected();if(!c){app.toast('اختار صورة أولاً');return;}
    const mult=$('#photoUnit').value==='cm'?10:1,w=+$('#photoW').value*mult,h=+$('#photoH').value*mult,st=app.state;
    if(!Number.isFinite(w)||!Number.isFinite(h)||w<1||h<1||w>st.paper.w||h>st.paper.h){app.toast('المقاس لازم يكون أكبر من 1 ملم وضمن أبعاد الورقة');return;}
    app.snapshot();c.mmW=w;c.mmH=h;c.w=w/st.paper.w*100;c.h=h/st.paper.h*100;c.x=Math.max(0,Math.min(c.x,100-c.w));c.y=Math.max(0,Math.min(c.y,100-c.h));app.render();app.persist();hide('sizeModal');app.toast(`تم ضبط القياس ${w.toFixed(2)} × ${h.toFixed(2)} ملم`);
  });

  // Repeat the selected card in a margin-aware grid on the current paper.
  $('#repeatBtn').addEventListener('click',()=>{
    if(!selected()){app.toast('اختار الصورة اللي تريد تكررها');return;}
    $('#repeatCount').value=8;show('repeatModal');
  });
  $('#applyRepeat').addEventListener('click',async()=>{
    const base=selected(),st=app.state;if(!base)return;
    const count=Math.max(1,Math.min(60,Math.round(+$('#repeatCount').value||1))),margin=Math.max(0,+$('#repeatMargin').value||0),gap=Math.max(0,+$('#repeatGap').value||0);
    if(margin*2>=st.paper.w||margin*2>=st.paper.h){app.toast('الهامش كبير على مقاس الورقة');return;}
    const img=await app.loadImage(base.src),ratio=img.naturalWidth/img.naturalHeight;
    let cols=Math.max(1,Math.ceil(Math.sqrt(count*st.paper.w/st.paper.h))),rows=Math.ceil(count/cols);
    let cellW=(st.paper.w-2*margin-gap*(cols-1))/cols,cellH=(st.paper.h-2*margin-gap*(rows-1))/rows;
    if(cellW<=0||cellH<=0){app.toast('قلّل عدد النسخ أو الهوامش');return;}
    const width=Math.min(cellW,cellH*ratio),height=width/ratio;
    if(width<7||height<7){app.toast('عدد النسخ كبير على هالورقة؛ قلّل العدد حتى تبقى الصورة واضحة');return;}
    app.snapshot();const cards=app.currentCards(),index=cards.indexOf(base),copies=[];
    for(let i=0;i<count;i++){
      const row=Math.floor(i/cols),col=i%cols,c={...base,id:app.newId(),rotate:0,flip:false};
      const x=margin+col*(cellW+gap)+(cellW-width)/2,y=margin+row*(cellH+gap)+(cellH-height)/2;
      c.x=x/st.paper.w*100;c.y=y/st.paper.h*100;c.w=width/st.paper.w*100;c.h=height/st.paper.h*100;c.mmW=width;c.mmH=height;copies.push(c);
    }
    cards.splice(index,1,...copies);app.selectCard(copies[0].id);app.persist();hide('repeatModal');app.toast(`تم ترتيب ${count} نسخة على ورقة ${st.paper.name}`);
  });

  // Image clarity: a lightweight unsharp-mask pass, kept local and undoable.
  $('#sharpness').addEventListener('input',()=>$('#sharpnessOut').textContent=$('#sharpness').value);
  $('#applySharpness').addEventListener('click',async()=>{
    const c=selected(),level=+$('#sharpness').value;if(!c){app.toast('اختار صورة أولاً');return;}if(level===0){app.toast('ارفع مستوى الحدة أولاً');return;}
    const img=await app.loadImage(c.src),scale=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,canvas.width,canvas.height);const original=ctx.getImageData(0,0,canvas.width,canvas.height),src=new Uint8ClampedArray(original.data),dst=original.data,w=canvas.width,h=canvas.height,amount=level/100*.72;
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const p=(y*w+x)*4;
      for(let k=0;k<3;k++)dst[p+k]=Math.max(0,Math.min(255,src[p+k]*(1+4*amount)-amount*(src[p-4+k]+src[p+4+k]+src[p-w*4+k]+src[p+w*4+k])));
    }
    ctx.putImageData(original,0,0);const out=canvas.toDataURL('image/png');app.updateAdjustmentPreview(out);app.toast('تمت معاينة زيادة الحدة؛ اضغط «تم» لحفظها');
  });

  // Arabic text layers are rendered at high resolution and stay inside the local project.
  async function makeTextData(text,style) {
    await document.fonts.ready;const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=520;const ctx=canvas.getContext('2d');
    ctx.direction='rtl';ctx.textAlign=style.align||'center';ctx.textBaseline='middle';ctx.fillStyle=style.color||'#111111';
    const fs=Math.max(14,Math.min(160,+style.size||48))*2.4;ctx.font=`${style.bold?'800':'500'} ${fs}px "${style.font||'Cairo'}", sans-serif`;
    const lines=[];for(const raw of String(text).split('\n')){
      let line='';for(const word of raw.split(/\s+/)){const test=line?line+' '+word:word;if(ctx.measureText(test).width>1450&&line){lines.push(line);line=word}else line=test}lines.push(line);
    }
    const lineHeight=Math.min(170,fs*1.35),startY=canvas.height/2-(lines.length-1)*lineHeight/2,x=style.align==='right'?1510:style.align==='left'?90:800;
    lines.slice(0,4).forEach((line,i)=>ctx.fillText(line,x,startY+i*lineHeight,1450));return canvas.toDataURL('image/png');
  }
  function openText(card=null){state.textCardId=card?.id||null;$('#artText').value=card?.text||'';const s=card?.textStyle||{};$('#artFont').value=s.font||'Cairo';$('#artFontSize').value=s.size||48;$('#artColor').value=s.color||'#111111';$('#artAlign').value=s.align||'center';$('#artBold').checked=s.bold!==false;$('#textHeading').textContent=card?'تعديل النص':'نص عربي واضح';$('#applyText').textContent=card?'حفظ التعديل':'إضافة النص';show('textModal');setTimeout(()=>$('#artText').focus(),100)}
  $('#textBtn').addEventListener('click',()=>openText());
  async function editText(){const c=selected();if(c?.kind==='text')openText(c);}
  $('#applyText').addEventListener('click',async()=>{
    const text=$('#artText').value.trim();if(!text){app.toast('اكتب نصاً أولاً');return;}
    const style={font:$('#artFont').value,size:+$('#artFontSize').value||48,color:$('#artColor').value,align:$('#artAlign').value,bold:$('#artBold').checked},src=await makeTextData(text,style),existing=state.textCardId&&app.currentCards().find(c=>c.id===state.textCardId);
    if(existing){app.snapshot();existing.src=src;existing.originalSrc=src;existing.text=text;existing.kind='text';existing.textStyle=style;const ar=1600/520;existing.h=existing.w*(app.state.paper.w/app.state.paper.h)/ar;app.render();app.persist();app.selectCard(existing.id);}
    else{const card=await app.addImageData(src,'نص: '+text.slice(0,24));card.kind='text';card.text=text;card.textStyle=style;const ar=1600/520;card.h=card.w*(app.state.paper.w/app.state.paper.h)/ar;app.render();app.persist();}
    state.textCardId=null;hide('textModal');app.toast('تمت إضافة النص العربي الواضح');
  });

  window.PrinovaTools={detectAddedCards,editText};
})();

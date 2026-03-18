const CORS_HEADERS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const rateMap = new Map<string,{count:number;reset:number}>();
function checkRateLimit(key:string):boolean{const now=Date.now();const e=rateMap.get(key)||{count:0,reset:now+3600000};if(now>e.reset){e.count=0;e.reset=now+3600000;}e.count++;rateMap.set(key,e);return e.count<=30;}
const SCHEMA=`{"name":"meal name","portion":"serving size","calories":number,"protein":number,"carbs":number,"fats":number,"fiber":number,"sugar":number,"items":[{"name":"item","calories":number,"protein":number,"carbs":number,"fats":number}],"micros":{"vitaminA":{"amount":number,"unit":"mcg","dv":number},"vitaminC":{"amount":number,"unit":"mg","dv":number},"vitaminD":{"amount":number,"unit":"IU","dv":number},"vitaminE":{"amount":number,"unit":"mg","dv":number},"calcium":{"amount":number,"unit":"mg","dv":number},"iron":{"amount":number,"unit":"mg","dv":number},"magnesium":{"amount":number,"unit":"mg","dv":number},"zinc":{"amount":number,"unit":"mg","dv":number},"potassium":{"amount":number,"unit":"mg","dv":number},"sodium":{"amount":number,"unit":"mg","dv":number},"omega3":{"amount":number,"unit":"g","dv":number},"folate":{"amount":number,"unit":"mcg","dv":number},"b12":{"amount":number,"unit":"mcg","dv":number},"selenium":{"amount":number,"unit":"mcg","dv":number}},"insights":["performance benefit","what it lacks","one improvement"],"rating":number}`;
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS_HEADERS});
  if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
  let body:Record<string,unknown>;
  try{body=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});}
  const{type,userEmail}=body as{type:string;userEmail:string};
  if(!checkRateLimit(userEmail||'anonymous'))return new Response(JSON.stringify({error:'Rate limit reached.'}),{status:429,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
  try{
    let text:string;
    if(type==='scan'){
      const key=Deno.env.get('ANTHROPIC_API_KEY');
      if(!key)return new Response(JSON.stringify({error:'Anthropic key not configured.'}),{status:503,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
      const{image}=body as{image:{base64:string;mediaType:string}};
      if(!image?.base64)return new Response(JSON.stringify({error:'Missing image'}),{status:400,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
      console.log(`[analyze-food] Image: ${Math.round(image.base64.length/1024)}KB`);
      if(image.base64.length>6000000)return new Response(JSON.stringify({error:'Image too large.'}),{status:400,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
      const mt=['image/jpeg','image/png','image/gif','image/webp'].includes((image.mediaType||'').toLowerCase())?image.mediaType:'image/jpeg';
      const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1800,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:mt,data:image.base64}},{type:'text',text:`Analyze this food photo. Return ONLY valid JSON:\n${SCHEMA}`}]}]})});
      const d=await res.json();
      console.log(`[analyze-food] Anthropic: ${res.status}`);
      if(!res.ok)throw new Error(d.error?.message||`Anthropic error ${res.status}`);
      text=d.content?.[0]?.text||'';
    }else if(type==='text'){
      const key=Deno.env.get('GROQ_API_KEY');
      if(!key)return new Response(JSON.stringify({error:'Groq key not configured.'}),{status:503,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
      const{meal,userContext}=body as{meal:string;userContext:Record<string,unknown>};
      if(!meal?.trim())return new Response(JSON.stringify({error:'Missing meal'}),{status:400,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
      const ctx=userContext||{};
      const prompt=`You are an elite sports nutritionist. Calculate macros for: "${meal}"\nUser: ${ctx.weight||'?'}lbs, goal: ${ctx.goal||'?'}, targets: ${ctx.calories||'?'}kcal / ${ctx.protein||'?'}g protein.\nReturn ONLY valid JSON:\n${SCHEMA}`;
      const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:prompt}],temperature:0.1,max_tokens:1800})});
      const d=await res.json();
      console.log(`[analyze-food] Groq: ${res.status}`);
      if(d.error)throw new Error(d.error.message||JSON.stringify(d.error));
      text=d.choices?.[0]?.message?.content||'';
    }else{
      return new Response(JSON.stringify({error:'type must be scan or text'}),{status:400,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
    }
    const cleaned=text.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
    let food:unknown;
    try{food=JSON.parse(cleaned);}catch{console.error('[analyze-food] parse failed:',text.slice(0,200));return new Response(JSON.stringify({error:'AI returned invalid data. Try a clearer photo.'}),{status:502,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});}
    return new Response(JSON.stringify({ok:true,food}),{status:200,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
  }catch(err){
    const msg=err instanceof Error?err.message:'Analysis failed.';
    console.error('[analyze-food] error:',msg);
    return new Response(JSON.stringify({error:msg}),{status:502,headers:{...CORS_HEADERS,'Content-Type':'application/json'}});
  }
});

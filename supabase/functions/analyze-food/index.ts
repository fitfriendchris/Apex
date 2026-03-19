const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const rm=new Map();function rl(k){const n=Date.now(),e=rm.get(k)||{c:0,r:n+3600000};if(n>e.r){e.c=0;e.r=n+3600000;}e.c++;rm.set(k,e);return e.c<=30;}
const S='{"name":"meal","portion":"size","calories":0,"protein":0,"carbs":0,"fats":0,"fiber":0,"sugar":0,"items":[{"name":"item","calories":0,"protein":0,"carbs":0,"fats":0}],"micros":{"vitaminA":{"amount":0,"unit":"mcg","dv":0},"vitaminC":{"amount":0,"unit":"mg","dv":0},"vitaminD":{"amount":0,"unit":"IU","dv":0},"vitaminE":{"amount":0,"unit":"mg","dv":0},"calcium":{"amount":0,"unit":"mg","dv":0},"iron":{"amount":0,"unit":"mg","dv":0},"magnesium":{"amount":0,"unit":"mg","dv":0},"zinc":{"amount":0,"unit":"mg","dv":0},"potassium":{"amount":0,"unit":"mg","dv":0},"sodium":{"amount":0,"unit":"mg","dv":0},"omega3":{"amount":0,"unit":"g","dv":0},"folate":{"amount":0,"unit":"mcg","dv":0},"b12":{"amount":0,"unit":"mcg","dv":0},"selenium":{"amount":0,"unit":"mcg","dv":0}},"insights":["benefit","lacks","tip"],"rating":0}';
Deno.serve(async(req)=>{
if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
if(req.method!=='POST')return new Response(JSON.stringify({error:'Method not allowed'}),{status:405,headers:{...CORS,'Content-Type':'application/json'}});
let body;try{body=await req.json();}catch{return new Response(JSON.stringify({error:'Invalid JSON'}),{status:400,headers:{...CORS,'Content-Type':'application/json'}});}
if(!rl(body.userEmail||'anon'))return new Response(JSON.stringify({error:'Rate limit reached.'}),{status:429,headers:{...CORS,'Content-Type':'application/json'}});
try{
let text='';
if(body.type==='scan'){
const key=Deno.env.get('ANTHROPIC_API_KEY');
if(!key)return new Response(JSON.stringify({error:'API key not configured.'}),{status:503,headers:{...CORS,'Content-Type':'application/json'}});
const img=body.image;
if(!img?.base64)return new Response(JSON.stringify({error:'Missing image'}),{status:400,headers:{...CORS,'Content-Type':'application/json'}});
console.log('[scan] image:',Math.round(img.base64.length/1024)+'KB');
const mt=['image/jpeg','image/png','image/webp','image/gif'].includes(img.mediaType)?img.mediaType:'image/jpeg';
const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1800,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:mt,data:img.base64}},{type:'text',text:'Analyze this food photo. Return ONLY valid JSON no markdown: '+S}]}]})});
const d=await r.json();console.log('[scan] anthropic:',r.status);
if(!r.ok)throw new Error(d.error?.message||'Anthropic error '+r.status);
text=d.content?.[0]?.text||'';
}else if(body.type==='text'){
const key=Deno.env.get('GROQ_API_KEY');
if(!key)return new Response(JSON.stringify({error:'Groq key not set.'}),{status:503,headers:{...CORS,'Content-Type':'application/json'}});
const meal=body.meal?.trim();
if(!meal)return new Response(JSON.stringify({error:'Missing meal'}),{status:400,headers:{...CORS,'Content-Type':'application/json'}});
const ctx=body.userContext||{};
const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model:'llama-3.3-70b-versatile',messages:[{role:'user',content:'Calculate macros for: "'+meal+'". User: '+ctx.weight+'lbs, goal: '+ctx.goal+', targets: '+ctx.calories+'kcal/'+ctx.protein+'g protein. Return ONLY valid JSON: '+S}],temperature:0.1,max_tokens:1800})});
const d=await r.json();console.log('[text] groq:',r.status);
if(d.error)throw new Error(d.error.message||'Groq error');
text=d.choices?.[0]?.message?.content||'';
}else{return new Response(JSON.stringify({error:'type must be scan or text'}),{status:400,headers:{...CORS,'Content-Type':'application/json'}});}
const cleaned=text.replace(/```json\s*/g,'').replace(/```\s*/g,'').trim();
let food;try{food=JSON.parse(cleaned);}catch{return new Response(JSON.stringify({error:'AI returned invalid data.'}),{status:502,headers:{...CORS,'Content-Type':'application/json'}});}
return new Response(JSON.stringify({ok:true,food}),{status:200,headers:{...CORS,'Content-Type':'application/json'}});
}catch(err){const m=err instanceof Error?err.message:'Failed';console.error('[error]',m);return new Response(JSON.stringify({error:m}),{status:502,headers:{...CORS,'Content-Type':'application/json'}});}
});

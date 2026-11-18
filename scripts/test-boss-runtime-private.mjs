import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {PNG} from "pngjs";
import {reconstructAtlas} from "../lib/atlas-inference.js";

const dirname="library_02/boss_1-2026-11-14T20-07-17-943Z";
const raw=fs.readFileSync(path.join(dirname,"boss_1.json"));
const json=JSON.parse(raw.toString("utf8"));
const png=fs.readFileSync(path.join(dirname,"boss_1.png"));
const bmp=PNG.sync.read(png);
const inferred=reconstructAtlas(json,[{name:"boss_1.png",width:bmp.width,height:bmp.height,rgba:bmp.data}]);
const content=new Map([
 ["/boss.json",{type:"application/json",body:raw}],
 ["/boss.atlas",{type:"text/plain",body:Buffer.from(inferred.text)}],
 ["/boss.png",{type:"image/png",body:png}],
]);
const serve=http.createServer((req,res)=>{
 const url=new URL(req.url,"http://localhost");
 const item=content.get(url.pathname);
 if(item){res.writeHead(200,{"Content-Type":item.type,"Cache-Control":"no-store"});res.end(item.body);return;}
 res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"});
 res.end('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}#player{width:900px;height:640px}</style></head><body><div id="player"></div></body></html>');
});
await new Promise(resolve=>serve.listen(0,"127.0.0.1",resolve));
const port=serve.address().port;
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--use-gl=angle","--use-angle=swiftshader"]});
try{
 for(const v of ["3.7","3.8"]){
  const p=await browser.newPage({viewport:{width:900,height:640}});
  const events=[];
  p.on("pageerror",e=>events.push("PAGE_"+e.message.slice(0,140)));
  try{
   await p.goto("http://127.0.0.1:"+port+"/",{waitUntil:"domcontentloaded"});
   await p.addScriptTag({path:path.resolve("public/vendor-spine-player-"+v+".js")});
   const state=await p.evaluate((versions)=>{
    window.__playerState={success:false,error:"",runtime:false,version:versions};
    try{
     window.__playerState.runtime=Boolean(window.spine&&window.spine.SpinePlayer);
     const animation=versions.idle||versions.first;
     window.__player=new window.spine.SpinePlayer("player",{
      jsonUrl:"/boss.json",atlasUrl:"/boss.atlas",animation,showControls:false,
      premultipliedAlpha:false,
      success:(player)=>{window.__playerState.success=true;window.__playerState.skeleton=!!player.skeleton;},
      error:(_player,message)=>{window.__playerState.error=String(message).slice(0,280);}
     });
    }catch(e){window.__playerState.error=String(e?.message||e).slice(0,280);}
    return window.__playerState;
   },{first:Object.keys(json.animations||{})[0]||"",idle:Object.keys(json.animations||{}).find(x=>/idle/i.test(x))});
   await p.waitForFunction(()=>window.__playerState.success||window.__playerState.error,null,{timeout:25000}).catch(()=>{});
   const summary=await p.evaluate(()=>({state:window.__playerState,
     canvasCount:document.querySelectorAll("canvas").length,
     canvasSize:[...document.querySelectorAll("canvas")].map(c=>[c.width,c.height]).slice(0,2)}));
   let visible=0,changed=0;
   if(summary.state.success){
    const first=PNG.sync.read(await p.screenshot({omitBackground:true}));
    await p.waitForTimeout(750);
    const second=PNG.sync.read(await p.screenshot({omitBackground:true}));
    for(let i=0;i<first.data.length;i+=4){
      if(first.data[i+3]>12 || second.data[i+3]>12)visible++;
      if(Math.abs(first.data[i]-second.data[i])+
         Math.abs(first.data[i+1]-second.data[i+1])+
         Math.abs(first.data[i+2]-second.data[i+2])+
         Math.abs(first.data[i+3]-second.data[i+3])>60)changed++;
    }
   }
   console.log(JSON.stringify({version:v,runtime:summary.state.runtime,
     accepted:summary.state.success,error:summary.state.error,
     canvas:summary.canvasCount,canvasSize:summary.canvasSize,
     visiblePixels:visible,movedPixels:changed,pageErrors:events.length}));
  }catch(e){console.log(JSON.stringify({version:v,error:e.name||"Error",runtimeFailure:true}));}
  finally{await p.close();}
 }
}finally{await browser.close();serve.close();}

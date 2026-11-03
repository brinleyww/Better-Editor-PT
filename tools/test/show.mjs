// Lays out a showcase of new blocks, imports it through the UI, and takes close-up shots.
import { openEditor, T } from './lib.mjs';
const W=+process.argv[2]||1280,H=+process.argv[3]||800;
const c = await openEditor(9339, W, H);
await c.evaluate(`(()=>{window.webpackChunk.push([[Symbol()],{},r=>window.__req=r]);return 1})()`);
const code = await c.evaluate(`(()=>{const req=__req,TD=req(9117).A,Sun=req(7929).A,P=req(494).A,H=req(2600).Hw;
  const t=new TD(0,new Sun(0));
  const add=(n,x,y,z,r=0)=>{const id=P[n];if(id==null)throw new Error(n);const d=H(id);t.addPart(x,y,z,id,r,0,0,d.detector&&d.detector.type==0?0:null,d.startOffset?0:null);};
  // A short drivable mix right in front of the camera
  add('PlasticStartRoad',0,0,0);add('PlasticRoadStraight',0,0,-4);add('PlasticCheckpointRoad',0,0,-8);add('WoodRoadStraight',0,0,-12);add('WoodFxTurboRoad',0,0,-16);add('WoodRoadStraight',0,0,-20);
  add('WoodRoadMediumStart',0,0,-24);add('WoodRoadMediumStraight',0,1,-28);add('WoodRoadMediumEnd',0,3,-32);add('PlasticRoadCurve3',0,4,-36);
  // Rows of blocks beside the lane
  const rows=[['PlasticRoadCurve2','PlasticRoadT','PlasticRoadCross','PlasticRoadChicane40x20R','PlasticRoadKicker','PlasticRoadTilt','PlasticRoadTiltCurve3In','PlasticRoadDiagStartR','PlasticRoadDiag','PlasticRoadCrest1'],
  ['WoodRoadCurve2','WoodRoadT','WoodRoadCross','WoodRoadChicane40x20R','WoodRoadKicker','WoodRoadTilt','WoodRoadTiltCurve3In','WoodRoadDiagStartR','WoodRoadDiag','WoodRoadCrest1'],
  ['PlasticPlatBase','PlasticPlatEdgeCorner','PlasticPlatMediumOuter','PlasticPlatMediumCone','PlasticPipeStraight','PlasticPipeCurve3','PlasticPlatBowlInner','PlasticPlatBowlOuter','PlasticPlatLoop20Q1','PlasticPlatWallStraight'],
  ['WoodPlatBase','WoodPlatEdgeCorner','WoodPlatMediumOuter','WoodPlatMediumCone','WoodPipeStraight','WoodPipeCurve3','WoodPlatBowlInner','WoodPlatBowlOuter','WoodPlatLoop20Q1','WoodPlatWallStraight'],
  ['PlasticStartPlat','PlasticFinishRoad','PlasticFxSuperPlat','PlasticFxNoEngineRoad','PlasticFxCruisePlat','WoodFinishOpen','WoodCheckpointPlat','WoodFxFragilePlat','PlasticRoadToPlat','WoodRoadToPlatLong'],
  ['PlasticSupportTrestle','WoodSupportTrestle','PlasticPyramid','WoodStairs','PlasticArch','WoodFence','PlasticCone','WoodCrate','PlasticSignLeft','WoodBarrel']];
  rows.forEach((row,j)=>row.forEach((n,i)=>add(n,8+j*8,0,-i*8)));
  return t.toExportString({name:'Block showcase',author:'tester',lastModified:null});})()`);
await c.clickText('Load'); await c.sleep(1200); await c.clickText('Import'); await c.sleep(1000);
await c.evaluate(`(()=>{const a=[...document.querySelectorAll('textarea')].find(x=>x.offsetParent);const s=Object.getOwnPropertyDescriptor(a.constructor.prototype,'value').set;s.call(a,${JSON.stringify(code)});a.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await c.sleep(400); await c.clickText('Import'); await c.sleep(4000);
const cam = async (x,y,z,tx,ty,tz,file) => { await c.evaluate(`window.__cam&&__cam(${x},${y},${z},${tx},${ty},${tz})`); await c.sleep(1200); await c.shot(T+file); };
// Orbit by dragging is fiddly, so use the zoom wheel and pan keys of the editor itself.
await c.shot(T+'bept_show0.png');
const mouse=(type,x,y,button='none',buttons=0)=>c.send('Input.dispatchMouseEvent',{type,x,y,button,buttons});
for(let i=0;i<8;i++) await c.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:400,y:400,deltaX:0,deltaY:300}); 
await c.sleep(1200); await c.shot(T+'bept_show1.png');
// pan right along the rows with right-drag
await mouse('mouseMoved',300,300); await c.send('Input.dispatchMouseEvent',{type:'mousePressed',x:300,y:300,button:'right',buttons:2,clickCount:1});
for(let i=1;i<=12;i++) await mouse('mouseMoved',300-i*22,300+i*14,'right',2);
await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:36,y:468,button:'right',buttons:0,clickCount:1});
await c.sleep(1500); await c.shot(T+'bept_show2.png');
console.log(c.logs.filter(l=>!/Failed to connect|NETFAIL/.test(l)).slice(0,10));
// and a driving view
await c.clickText('Test'); await c.sleep(5000);
await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38});
await c.sleep(1500); await c.shot(T+'bept_drive_summer1.png');
await c.sleep(1800); await c.shot(T+'bept_drive_summer2.png');
await c.close(); process.exit(0);

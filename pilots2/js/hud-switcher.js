(function(){'use strict';
var items=[['all','Общий прогресс',1920,1080],['sim','Технический симулятор',1920,1080],['basket','Дрон-баскетбол',1920,1080],['race','Гонка 75 мм',1920,1080],['results','Итоговые результаты',1920,1080],['side','Боковой виджет',480,900]];
var selected=items[0],active=null,whitekey=false,key='pf-cg2-hud-output-v1',channel;
var $=function(id){return document.getElementById(id)};
try{channel=new BroadcastChannel('pf-cg2-hud-output')}catch(e){}
function url(it){return 'native-hud.html?type='+encodeURIComponent(it[0])}
function render(){var u=url(selected);$('preview').src=u;$('previewName').textContent=selected[1];$('open').href=u;$('vmixUrl').value=new URL('hud-output.html',location.href).href;$('previewBox').classList.toggle('side',selected[0]==='side');$('preview').classList.toggle('whitekey',whitekey);Array.from($('sources').children).forEach(function(b){b.classList.toggle('selected',b.dataset.id===selected[0])});$('status').textContent='PREVIEW: '+selected[1]+' · '+selected[2]+'×'+selected[3]+' · оригинальный HUD'}
function setProgram(it){active=it;$('program').src=it?url(it):'about:blank';$('programName').textContent=it?it[1]:'—';$('programBox').classList.toggle('side',!!it&&it[0]==='side');$('program').classList.toggle('whitekey',whitekey)}
function send(it){var data={id:it?it[0]:null,whitekey:whitekey,at:Date.now()};try{localStorage.setItem(key,JSON.stringify(data))}catch(e){}try{if(channel)channel.postMessage(data)}catch(e){}setProgram(it)}
function receive(data){if(!data)return;whitekey=!!data.whitekey;if($('whitekey'))$('whitekey').checked=whitekey;render();setProgram(items.find(function(it){return it[0]===data.id})||null)}
items.forEach(function(it){var b=document.createElement('button');b.className='item';b.dataset.id=it[0];b.textContent=it[1];var s=document.createElement('small');s.textContent=it[2]+' × '+it[3];b.appendChild(s);b.onclick=function(){selected=it;render()};$('sources').appendChild(b)});
$('whitekey').onchange=function(){whitekey=this.checked;render();send(active)};$('take').onclick=function(){send(selected)};$('out').onclick=function(){send(null)};$('reload').onclick=function(){render();setProgram(active)};$('copy').onclick=function(){navigator.clipboard.writeText($('vmixUrl').value).then(function(){$('status').textContent='Ссылка на оригинальный HUD скопирована'}).catch(function(){$('vmixUrl').select();document.execCommand('copy')})};
if(channel)channel.onmessage=function(e){receive(e.data)};window.addEventListener('storage',function(e){if(e.key===key)try{receive(JSON.parse(e.newValue))}catch(err){}});
try{receive(JSON.parse(localStorage.getItem(key)))}catch(e){}render();
})();
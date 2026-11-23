/*************************************************************
 * 만천초 국내여비 정산 신청서 — 구글 시트 연동 웹 앱 (Apps Script)
 *
 *  붙이는 곳 : 구글 시트 「만천초 여비 정산 신청서」
 *              → 확장 프로그램 → Apps Script → 이 코드 전체 붙여넣기 → 저장
 *
 *  배포      : 배포 → 배포 관리 → (지금 쓰는 배포의) 연필 → 버전 '새 버전' → 배포
 *              · 다음 사용자로 실행 : 나
 *              · 액세스 권한이 있는 사용자 : 모든 사용자
 *              → 주소(.../exec)는 그대로 유지됩니다.
 *
 *  시트 ID   : 1MopKOI1ZnKJqORRTxNCiBot_5_nbC_GGAirCLQ1Yt5w
 *  시트 탭   : 여비 정산 신청서
 *
 *  ※ 이 판(v2)에서 더해진 것 — 「다른 사람이 입력 중」 표시
 *    · POST action='typing'  : { clientId, who, typing:true|false } 신호만 스크립트 속성에 저장
 *                              (시트 셀은 절대 건드리지 않음)
 *    · GET  action='state'   : 9초 안에 들어온 입력 중 신호가 있으면 typing:{clientId, who, ageMs} 를 함께 내려줌
 *    · 예전 앱(ping / state / batchUpdate)과 100% 그대로 호환됩니다.
 *************************************************************/

var SHEET_ID   = '1MopKOI1ZnKJqORRTxNCiBot_5_nbC_GGAirCLQ1Yt5w';
var SHEET_NAME = '여비 정산 신청서';

/* 웹 앱 입력칸 ↔ 시트 셀 (A1 표기) */
var FIELDS = {
  org:          'B4',   // 소속 (기본값 만천초등학교)
  rank:         'H4',   // 직급(직위)
  name:         'L4',   // 성명

  tripTime:     'C5',   // 출장 일시 — '2026-11-30 ~ 2026-12-01' 형태(같은 날이면 하루)
  destination:  'C6',   // 출장(부임)지

  lodgeLimit:   'C8',   // 숙박비 상한액 또는 지급받은 선금
  lodgeActual:  'E8',   // 숙박비 실제 소요액
  lodgeReason:  'J8',   // 숙박비 초과지출 사유

  fare1Date:    'B11', fare1Mode: 'C11', fare1From: 'D11', fare1To: 'E11', fare1Class: 'I11', fare1Amount: 'J11',
  fare2Date:    'B12', fare2Mode: 'C12', fare2From: 'D12', fare2To: 'E12', fare2Class: 'I12', fare2Amount: 'J12',
  fare3Date:    'B13', fare3Mode: 'C13', fare3From: 'D13', fare3To: 'E13', fare3Class: 'I13', fare3Amount: 'J13',
  fare4Date:    'B14', fare4Mode: 'C14', fare4From: 'D14', fare4To: 'E14', fare4Class: 'I14', fare4Amount: 'J14',

  paxTotal:     'C15',  // 총 동승자수(신청인 포함)

  pax1Name:     'J16',  // 동승자 성명 1~4 (신청인 제외)
  pax2Name:     'J17',
  pax3Name:     'J18',
  pax4Name:     'J19',

  attach:       'C21',  // 첨부
  applyDate:    'C23',  // 신청일
  applicant:    'C24'   // 신청인 성명
};

var DATE_FIELDS = ['fare1Date','fare2Date','fare3Date','fare4Date','applyDate'];
var NUM_FIELDS  = ['lodgeLimit','lodgeActual','fare1Amount','fare2Amount','fare3Amount','fare4Amount'];
var INT_FIELDS  = ['paxTotal'];

/* ---------------- 공통 ---------------- */
function out(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function nowText(){
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}
function sheet(){
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if(!sh) sh = ss.getSheets()[0];
  return sh;
}
function pad2(n){ return (n < 10 ? '0' : '') + n; }
function toISO(d){
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function parseISO(s){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if(!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/* ---------------- 「입력 중」 표시 ----------------
   값이 아니라 '지금 누가 치고 있는지'만 잠깐 담아 두는 자리.
   시트 셀은 건드리지 않고 스크립트 속성(PropertiesService)만 쓴다.
   신호가 9초 넘게 끊기면 저절로 없는 것으로 본다(앱이 2.5초마다 다시 보냄).
*/
var TYPING_KEY    = 'TRAVEL_TYPING';
var TYPING_TTL_MS = 9000;
var TYPING_WHO_MAX = 20;

function typingRaw(){
  try{
    var raw = PropertiesService.getScriptProperties().getProperty(TYPING_KEY);
    if(!raw) return null;
    var o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : null;
  }catch(e){ return null; }
}
/* 지금 '입력 중'인 사람 — 신호가 살아 있을 때만 돌려준다 */
function readTyping(){
  var o = typingRaw();
  if(!o || !o.ts) return null;
  var age = new Date().getTime() - Number(o.ts);
  if(!(age >= 0)) age = 0;
  if(age > TYPING_TTL_MS) return null;
  var who = String(o.who == null ? '' : o.who).replace(/[\r\n]+/g, ' ').trim();
  if(who.length > TYPING_WHO_MAX) who = who.slice(0, TYPING_WHO_MAX);
  return { clientId: String(o.clientId == null ? '' : o.clientId), who: who, ageMs: age };
}
/* 입력 중 신호 저장 — typing:false 면 그 사람이 보낸 신호를 지운다 */
function writeTyping(body){
  var props = PropertiesService.getScriptProperties();
  var cid = String(body.clientId == null ? '' : body.clientId).slice(0, 60);

  if(body.typing === false || body.typing === 'false' || body.typing === 0){
    var cur = typingRaw();
    /* 다른 사람이 입력 중이면 그 신호는 그대로 둔다 */
    if(!cur || !cid || String(cur.clientId || '') === cid) props.deleteProperty(TYPING_KEY);
    return;
  }
  var who = String(body.who == null ? '' : body.who).replace(/[\r\n]+/g, ' ').trim();
  if(who.length > TYPING_WHO_MAX) who = who.slice(0, TYPING_WHO_MAX);
  props.setProperty(TYPING_KEY, JSON.stringify({
    clientId: cid, who: who, ts: new Date().getTime()
  }));
}

/* 시트 → 앱 */
function readAll(sh){
  var vals = {};
  Object.keys(FIELDS).forEach(function(k){
    var v = sh.getRange(FIELDS[k]).getValue();
    if(v instanceof Date){
      vals[k] = toISO(v);
    } else if(v === null || v === undefined){
      vals[k] = '';
    } else if(typeof v === 'number'){
      vals[k] = String(v);
    } else {
      vals[k] = String(v).trim();
    }
  });
  return vals;
}

/* 앱 → 시트 */
function writeField(sh, key, value){
  var a1 = FIELDS[key];
  if(!a1) return false;
  var cell = sh.getRange(a1);
  var v = (value === null || value === undefined) ? '' : value;

  if(DATE_FIELDS.indexOf(key) >= 0){
    var d = parseISO(v);
    cell.setValue(d ? d : '');
    return true;
  }
  if(INT_FIELDS.indexOf(key) >= 0){
    var n = String(v).replace(/[^0-9]/g, '');
    cell.setValue(n === '' ? '' : Number(n));
    return true;
  }
  if(NUM_FIELDS.indexOf(key) >= 0){
    var m = String(v).replace(/[^0-9]/g, '');
    cell.setValue(m === '' ? '' : Number(m));
    return true;
  }
  cell.setValue(String(v));
  return true;
}

/* ---------------- GET : ping / state ---------------- */
function doGet(e){
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  try{
    if(action === 'ping'){
      var sh = sheet();
      return out({
        ok: true,
        message: '연결되었습니다.',
        serverTime: nowText(),
        sheetTitle: sh.getName(),
        fields: Object.keys(FIELDS).length
      });
    }
    if(action === 'state'){
      var sh2 = sheet();
      var res = { ok: true, serverTime: nowText(), values: readAll(sh2) };
      /* 다른 사람이 입력 중이면 함께 알려 준다(없으면 이 칸 자체가 없다 → 예전 앱도 그대로 동작) */
      try{
        var tp = readTyping();
        if(tp) res.typing = tp;
      }catch(e1){}
      return out(res);
    }
    return out({ ok: false, error: '알 수 없는 요청: ' + action });
  }catch(err){
    return out({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ---------------- POST : typing / batchUpdate ---------------- */
function doPost(e){
  var body = {};
  try{
    if(e && e.postData && e.postData.contents){
      body = JSON.parse(e.postData.contents);
    }
  }catch(err){
    return out({ ok: false, error: '요청 내용을 읽지 못했습니다.' });
  }
  var action = body.action || 'batchUpdate';

  /* 입력 중 신호 — 시트는 건드리지 않는다 */
  if(action === 'typing'){
    try{
      writeTyping(body);
      return out({ ok: true, typing: readTyping(), serverTime: nowText() });
    }catch(err){
      return out({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  }
  if(action !== 'batchUpdate'){
    return out({ ok: false, error: '알 수 없는 요청: ' + action });
  }

  var lock = LockService.getScriptLock();
  try{
    /* 값 저장 요청에 입력 중 정보가 같이 실려 오면 함께 반영 */
    if(body.typing !== undefined){
      try{ writeTyping(body); }catch(e3){}
    }

    var updates = body.updates || [];
    if(!updates.length){
      return out({ ok: true, saved: 0, serverTime: nowText() });
    }

    lock.waitLock(20000);
    var sh = sheet();
    var saved = 0;
    updates.forEach(function(u){
      if(!u || !u.field) return;
      if(writeField(sh, u.field, u.value)) saved++;
    });
    SpreadsheetApp.flush();
    lock.releaseLock();

    return out({ ok: true, saved: saved, clientId: body.clientId || '', serverTime: nowText() });
  }catch(err){
    try{ lock.releaseLock(); }catch(e2){}
    return out({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ---------------- 확인용 (편집기에서 직접 실행) ---------------- */
function testRead(){
  var sh = sheet();
  Logger.log(JSON.stringify(readAll(sh), null, 2));
}
function testWrite(){
  var sh = sheet();
  writeField(sh, 'tripTime', '2026-11-30 ~ 2026-12-01');
  SpreadsheetApp.flush();
  Logger.log(JSON.stringify(readAll(sh), null, 2));
}
function testTyping(){
  writeTyping({ clientId: 'test', who: '테스트', typing: true });
  Logger.log(JSON.stringify(readTyping()));
  writeTyping({ clientId: 'test', typing: false });
  Logger.log(JSON.stringify(readTyping()));
}

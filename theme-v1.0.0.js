<script>
(async () => {
// ============ 自动更新模块 ============
const _PREV_VER = '1.0.0'; // 当前版本号，每次发新版时手动改这里
const _SIG = '@@THEME_PLUGIN_ID@@'; // 不要删除，更新模块靠这个识别自己
const UPDATE_CHECK_URL = 'https://cdn.jsdelivr.net/gh/shbaby99/ufi-theme-updater@main/latest.json';
const UPDATE_CDN_MIRRORS = ['cdn.jsdelivr.net', 'cdn.jsdmirror.com', 'jsd.onmicrosoft.cn'];
let _manifest = null;
let _updating = false;

const _sq = (v) => `'${String(v ?? '').replace(/'/g, `'\\''`)}'`;
const _wait = (ms) => new Promise(r => setTimeout(r, ms));
const _run = async (cmd, timeout = 30000) => {
  try { return await runShellWithRoot(cmd, timeout) || { content: '' }; } 
  catch { return { content: '' }; }
};

const _probeBestCdn = async () => {
  const results = [];
  for (const node of UPDATE_CDN_MIRRORS) {
    const url = UPDATE_CHECK_URL.replace('cdn.jsdelivr.net', node);
    const start = Date.now();
    const r = await _run(`curl -sL --connect-timeout 3 --max-time 5 -w '%{http_code}' -o /dev/null ${_sq(url)}`, 8000);
    if (String(r?.content || '').trim() === '200') results.push({ node, rtt: Date.now() - start });
  }
  return results.length ? results.sort((a, b) => a.rtt - b.rtt)[0].node : 'cdn.jsdelivr.net';
};

const _fetchManifest = async () => {
  const bestNode = await _probeBestCdn();
  const url = UPDATE_CHECK_URL.replace('cdn.jsdelivr.net', bestNode) + '?_=' + Date.now();
  const tmp = '/data/local/tmp/_theme_manifest.tmp';
  await _run(`rm -f ${_sq(tmp)}`, 1000);
  const r = await _run(`curl -sL --connect-timeout 8 --max-time 30 ${_sq(url)} -o ${_sq(tmp)} && cat ${_sq(tmp)}`, 40000);
  const text = String(r?.content || '').trim();
  await _run(`rm -f ${_sq(tmp)}`, 1000);
  if (!text || text[0] !== '{') return null;
  try {
    const j = JSON.parse(text);
    if (j.version && j.js) return j;
  } catch {}
  return null;
};

const _applyPluginJs = async (newJsUrl, prevVer) => {
  const tmpJs = '/data/local/tmp/_theme_new.js';
  await _run(`rm -f ${_sq(tmpJs)}`, 2000);
  const dl = await _run(`curl -sL --connect-timeout 8 --max-time 60 ${_sq(newJsUrl)} -o ${_sq(tmpJs)} && wc -c < ${_sq(tmpJs)}`, 65000);
  const size = parseInt(String(dl?.content || '0').trim(), 10) || 0;
  if (size < 500) { await _run(`rm -f ${_sq(tmpJs)}`); throw new Error('新文件下载失败或过小'); }
  
  const currentText = await getCustomHead();
  if (!currentText) throw new Error('无法读取插件列表');
  
  const _esc = s => s.replace(/[\[\]]/g, '\\$&');
  const _PS = '<!-- [KANO_PLUGIN_START]';
  const _PE = '<!-- [KANO_PLUGIN_END]';
  const pluginRegex = new RegExp(_esc(_PS) + '\\s*(.*?)\\s*-->([\\s\\S]*?)' + _esc(_PE) + '\\s*\\1\\s*-->', 'g');
  
  const newJs = await _run(`cat ${_sq(tmpJs)}`, 10000);
  let newJsContent = String(newJs?.content || '');
  if (!newJsContent || newJsContent.length < 500) throw new Error('新文件内容异常');
  if (prevVer) newJsContent = newJsContent.replace(/const _PREV_VER = '[^']*'/, `const _PREV_VER = '${prevVer}'`);
  
  let found = false, newText = currentText, match;
  while ((match = pluginRegex.exec(currentText)) !== null) {
    if (match[2].includes(_SIG)) {
      const pluginName = match[1].trim();
      const newBlock = `${_PS} ${pluginName} -->\n${newJsContent}\n${_PE} ${pluginName} -->`;
      newText = currentText.replace(match[0], () => newBlock);
      found = true;
      break;
    }
  }
  if (!found) { await _run(`rm -f ${_sq(tmpJs)}`); throw new Error('未找到当前插件，请手动重新导入'); }
  await _run(`rm -f ${_sq(tmpJs)}`, 2000);
  const saveResult = await setCustomHead(newText);
  if (!saveResult || saveResult.result !== 'success') throw new Error('保存失败');
  return true;
};

const _checkUpdateInBackground = async () => {
  try {
    const m = await _fetchManifest();
    if (!m) return;
    _manifest = m;
    if (m.version === _PREV_VER) return;
    // 弹窗打开时，动态修改标题
    const titleEl = document.querySelector('#' + MODAL + ' .title');
    if (titleEl && !titleEl.querySelector('#ufi-title-update')) {
      titleEl.innerHTML += ` <span id="ufi-title-update" style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;font-size:.65rem;color:#4ade80;cursor:pointer;font-weight:normal;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 4px #4ade80;"></span>有新版本！</span>`;
      document.querySelector('#ufi-title-update').onclick = () => _performUpdateFlow();
    }
  } catch (e) { console.warn('[Theme Updater]', e); }
};

const _performUpdateFlow = async () => {
  if (_updating) return;
  if (!_manifest) { _manifest = await _fetchManifest(); }
  if (!_manifest || _manifest.version === _PREV_VER) {
    return createToast('当前已是最新版本 v' + _PREV_VER, 'green');
  }
  const ok = await new Promise(resolve => {
    const { el, close } = createFixedToast('ufi_theme_update_confirm', `
      <div style="pointer-events:all;width:88vw;max-width:400px">
        <div class="title" style="margin:0 0 8px">发现新版本 v${_manifest.version}</div>
        <div style="font-size:.58rem;line-height:1.6;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:8px 10px;max-height:40vh;overflow-y:auto;white-space:pre-wrap;">${_manifest.notes || '暂无更新说明'}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
          <button id="ufi_theme_upd_cancel" style="font-size:.62rem;padding:5px 14px;border-radius:7px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:inherit;cursor:pointer;">取消</button>
          <button id="ufi_theme_upd_ok" style="font-size:.62rem;padding:5px 14px;border-radius:7px;border:1px solid rgba(34,197,94,.4);background:rgba(34,197,94,.25);color:#86efac;cursor:pointer;">确认更新</button>
        </div>
      </div>`);
    el.querySelector('#ufi_theme_upd_cancel').onclick = () => { close(); resolve(false); };
    el.querySelector('#ufi_theme_upd_ok').onclick = () => { close(); resolve(true); };
  });
  if (!ok) return;
  _updating = true;
  const { close: closeLoading } = createFixedToast('ufi_theme_updating', '正在更新...');
  try {
    await _applyPluginJs(_manifest.js, _PREV_VER);
    closeLoading();
    createToast('已更新到 v' + _manifest.version + '，2秒后刷新页面', 'green');
    setTimeout(() => location.reload(), 2000);
  } catch (e) {
    closeLoading();
    createToast('更新失败：' + (e?.message || e), 'red', 4000);
  } finally { _updating = false; }
};
// ============ 自动更新模块结束 ============

const MODAL = 'ufi_icon_switcher_modal';
const STYLE_ID = 'ufi_icon_switcher_style';
const STORE_KEY = 'ufi_icon_style_pref';
const COLOR_KEY = 'ufi_icon_colorful_pref';

let currentStyle = localStorage.getItem(STORE_KEY) || 'material';
let colorfulMode = localStorage.getItem(COLOR_KEY) === 'true';
let observer = null;

const logoSvgData = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#4CAE50" rx="80"/><rect x="80" y="120" width="352" height="200" rx="40" fill="#FCE6DD" stroke="#611624" stroke-width="24"/><path d="M160 200 Q256 140 352 200" fill="none" stroke="#611624" stroke-width="20"/><path d="M190 240 Q256 190 322 240" fill="none" stroke="#611624" stroke-width="20"/><path d="M220 280 Q256 240 292 280" fill="none" stroke="#611624" stroke-width="20"/><circle cx="256" cy="310" r="16" fill="#611624"/><rect x="80" y="320" width="352" height="80" rx="30" fill="#F5A69F" stroke="#611624" stroke-width="24"/><circle cx="140" cy="360" r="10" fill="#611624"/><circle cx="200" cy="360" r="10" fill="#611624"/><circle cx="260" cy="360" r="10" fill="#611624"/><circle cx="320" cy="360" r="10" fill="#611624"/><circle cx="380" cy="360" r="10" fill="#611624"/></svg>';
const logoUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(logoSvgData);

const ICON_MAP = {
  '登录/登出': 'login', '停止刷新': 'pause', '更改口令': 'key', '更改密码': 'lock', '重启设备': 'refresh',
  '定时重启': 'clock', '主题背景': 'palette', '插件功能': 'puzzle', '短信收发': 'mail', '流量管理': 'database',
  '流量历史': 'trending-up', '内网测速': 'zap', '流量测速': 'activity', '接入设备': 'smartphone', 'WIFI设置': 'wifi',
  '内网设置': 'network', 'AT指令': 'terminal', '高级功能': 'sliders', '数据开关': 'power', '指示灯': 'lightbulb',
  '网络漫游': 'globe', '短信转发': 'forward', '定时任务': 'calendar', 'APN设置': 'router', 'USB状态': 'usb',
  '软件更新': 'download', '5G/4G/3G': 'signal', 'USB上网': 'cable', 'SIM2': 'credit-card', '卡状态': 'sim',
  '设备监控': 'server', '基本状态': 'info', 'TTYD': 'command', '锁定频段': 'lock', '锁定基站': 'map-pin',
  '常规设置': 'settings', '网络设置': 'wifi', '关于设备': 'info', '系统日志': 'file-text', '重启与重置': 'restart',
  '中文': 'globe', '插件收纳箱': 'archive',
  '5G接收功率': 'signal', '5G SINR': 'activity', '5G RSRQ': 'trending-down', '5G注册频段': 'radio',
  '5G频率': 'wave', '5G PCI': 'hash', '5G基站ID': 'server', '开机时长': 'clock', '客户端IP': 'globe',
  '设备型号': 'smartphone', '版本号': 'tag', 'ICCID': 'credit-card', 'IMEI': 'smartphone', 'IMSI': 'sim',
  'IPv6地址': 'globe', '本地网关': 'network', 'MAC': 'hard-drive', '内部存储': 'hard-drive', 'SD卡': 'sd-card',
  'QCI': 'sliders', '网络状态': 'wifi', 'WIFI连接': 'wifi', '信号强度': 'signal', 'CPU温度': 'thermometer',
  'CPU占用': 'cpu', '内存占用': 'hard-drive', '连接时长': 'clock', '已用流量': 'database', '当日流量': 'trending-up',
  '本月已用': 'calendar', '当前网速': 'activity', '管理字段': 'sliders', '1秒': 'clock',
  '导出': 'download', '禁用': 'x', '启用': 'check', '提交': 'check', '查询': 'search', '重置': 'refresh',
  '刷新': 'refresh', '重置主题': 'palette', '上传图片': 'upload', '发送': 'upload', '开始测速': 'activity',
  '循环测速': 'refresh', '快捷指令': 'zap', '任务管理': 'calendar', '一键更新': 'download', '下载安装包': 'download',
  '移除高级功能': 'x', '禁用ZXE固件更新': 'x', '编辑启动脚本': 'edit', '提取Boot': 'download',
  '启用唤醒锁': 'unlock', '禁用唤醒锁': 'lock', '有线ADB': 'usb', '无线ADB': 'wifi', '性能模式': 'zap',
  '添加高级功能': 'plus', '添加任务': 'plus', 'SMTP方式': 'mail', 'CURL方式': 'command', '钉钉方式': 'message',
  '签约速率': 'activity', '强力查串': 'search', '填入改串指令': 'edit', '基带信息': 'info', '重启基带': 'refresh',
  'VoLTE(slot0)': 'phone', 'VoNR(slot0)': 'phone', 'VoLTE(slot1)': 'phone', 'VoNR(slot1)': 'phone', '高铁模式': 'train'
};

const SVG_PATHS = {
  'login': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  'pause': '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  'key': '<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/>',
  'lock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'unlock': '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  'refresh': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'palette': '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  'puzzle': '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  'mail': '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  'message': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'database': '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  'trending-up': '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
  'trending-down': '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'activity': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  'smartphone': '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  'wifi': '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  'network': '<rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M12 8v4M6 16v-2h12v2"/>',
  'terminal': '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  'command': '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  'sliders': '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  'power': '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  'lightbulb': '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
  'globe': '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  'forward': '<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
  'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'router': '<rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6.01 18H6.02M10.01 18H10.02M14.01 18H14.02M18.01 18H18.02M12 10V6M12 6l-2-2M12 6l2-2"/>',
  'usb': '<path d="M4 14h6v6H4z"/><path d="M10 17h4a2 2 0 0 0 2-2V9a2 2 0 0 1 2-2h4"/><circle cx="2" cy="17" r="2"/>',
  'cable': '<path d="M4 14h6v6H4z"/><path d="M10 17h4a2 2 0 0 0 2-2V9a2 2 0 0 1 2-2h4"/><circle cx="2" cy="17" r="2"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  'signal': '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  'credit-card': '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  'sim': '<rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M8 6h8M8 10h8M8 14h4"/>',
  'server': '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  'info': '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  'map-pin': '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  'settings': '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  'restart': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  'archive': '<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
  'radio': '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"/>',
  'wave': '<path d="M2 12h2a4 4 0 0 1 8 0h2a4 4 0 0 1 8 0h2"/>',
  'hash': '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  'tag': '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  'hard-drive': '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  'sd-card': '<path d="M4 4a2 2 0 0 1 2-2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z"/><path d="M8 4h2v4H8zM12 4h2v4h-2z"/>',
  'thermometer': '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
  'cpu': '<rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  'search': '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  'x': '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'check': '<polyline points="20 6 9 17 4 12"/>',
  'plus': '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  'edit': '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'phone': '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  'train': '<rect x="4" y="3" width="16" height="16" rx="2" ry="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M16 19l2 3"/>'
};

const EMOJI_LIB = {
  'login': '🔐', 'pause': '⏸️', 'key': '🔑', 'lock': '🔒', 'unlock': '🔓', 'refresh': '🔄', 'clock': '⏰', 'palette': '🎨',
  'puzzle': '🧩', 'mail': '✉️', 'message': '💬', 'database': '📊', 'trending-up': '📈', 'trending-down': '📉', 'zap': '⚡',
  'activity': '📉', 'smartphone': '📱', 'wifi': '📶', 'network': '🕸️', 'terminal': '⌨️', 'command': '⌨️', 'sliders': '🎛️',
  'power': '🔛', 'lightbulb': '💡', 'globe': '🌐', 'forward': '📨', 'calendar': '📅', 'router': '📡',
  'usb': '🔌', 'cable': '🔌', 'download': '📥', 'upload': '📤', 'signal': '📶', 'credit-card': '💳', 'sim': '📇',
  'server': '🖥️', 'info': 'ℹ️', 'map-pin': '📍', 'settings': '⚙️', 'file-text': '📜', 'restart': '🔄', 'archive': '📦',
  'radio': '📡', 'wave': '🌊', 'hash': '#️⃣', 'tag': '🏷️', 'hard-drive': '💾', 'sd-card': '💳', 'thermometer': '🌡️',
  'cpu': '🧠', 'search': '🔍', 'x': '❌', 'check': '✅', 'plus': '➕', 'edit': '✏️', 'phone': '📞', 'train': '🚄'
};

const COLOR_MAP = {
  'login': '#f43f5e', 'log-out': '#f43f5e', 'pause': '#f59e0b', 'key': '#eab308', 'lock': '#ef4444', 'unlock': '#22c55e',
  'refresh': '#3b82f6', 'clock': '#8b5cf6', 'palette': '#ec4899', 'puzzle': '#10b981', 'mail': '#06b6d4', 'message': '#06b6d4',
  'database': '#f97316', 'trending-up': '#f97316', 'trending-down': '#ef4444', 'zap': '#f59e0b',
  'activity': '#0ea5e9', 'smartphone': '#0ea5e9', 'wifi': '#0ea5e9', 'network': '#3b82f6', 'terminal': '#22c55e',
  'command': '#22c55e', 'sliders': '#10b981', 'power': '#eab308', 'lightbulb': '#f59e0b', 'globe': '#0ea5e9', 'forward': '#06b6d4',
  'calendar': '#8b5cf6', 'router': '#0ea5e9', 'usb': '#f97316', 'cable': '#f97316', 'download': '#0ea5e9', 'upload': '#0ea5e9',
  'signal': '#0ea5e9', 'credit-card': '#ec4899', 'sim': '#ec4899', 'server': '#0ea5e9', 'info': '#64748b',
  'map-pin': '#ef4444', 'settings': '#10b981', 'file-text': '#64748b', 'restart': '#3b82f6', 'archive': '#8b5cf6',
  'radio': '#0ea5e9', 'wave': '#0ea5e9', 'hash': '#64748b', 'tag': '#10b981', 'hard-drive': '#f59e0b', 'sd-card': '#ec4899',
  'thermometer': '#ef4444', 'cpu': '#3b82f6', 'search': '#3b82f6', 'x': '#ef4444', 'check': '#10b981', 'plus': '#3b82f6',
  'edit': '#ec4899', 'phone': '#8b5cf6', 'train': '#f59e0b'
};

const STYLE_LIBS = {
  'system': { name: '系统默认', type: 'none' },
  'emoji': { name: '系统 Emoji', type: 'emoji', lib: EMOJI_LIB },
  'material': { name: 'Material 实心', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none' },
  'lucide': { name: 'Lucide 极简', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', linecap: 'round' },
  'feather': { name: 'Feather 细线', type: 'svg', lib: SVG_PATHS, stroke: 1.5, fill: 'none', linecap: 'round' },
  'fontawesome': { name: 'FontAwesome 粗线', type: 'svg', lib: SVG_PATHS, stroke: 3, fill: 'none', linecap: 'round' },
  'bold': { name: '特粗线条', type: 'svg', lib: SVG_PATHS, stroke: 4, fill: 'none', linecap: 'round' },
  'thin': { name: '极细线条', type: 'svg', lib: SVG_PATHS, stroke: 1, fill: 'none', linecap: 'round' },
  'dashed': { name: '虚线轮廓', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', linecap: 'round', dasharray: '4 2' },
  'dotted': { name: '点状虚线', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', linecap: 'round', dasharray: '1 3' },
  'dash-long': { name: '长虚线', type: 'svg', lib: SVG_PATHS, stroke: 2.5, fill: 'none', linecap: 'round', dasharray: '8 4' },
  'dash-dot': { name: '点划线', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', linecap: 'round', dasharray: '6 2 2 2' },
  'sharp': { name: '硬朗直角', type: 'svg', lib: SVG_PATHS, stroke: 2.5, fill: 'none', linecap: 'square', linejoin: 'miter' },
  'pixel': { name: '像素方块', type: 'svg', lib: SVG_PATHS, stroke: 3, fill: 'none', linecap: 'square', linejoin: 'miter' },
  'double-line': { name: '双线风格', type: 'svg', lib: SVG_PATHS, stroke: 3.5, fill: 'none', linecap: 'round', doubleLine: true },
  'shadow': { name: '投影线条', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', linecap: 'round', shadow: true },
  'bold-shadow': { name: '粗线带影', type: 'svg', lib: SVG_PATHS, stroke: 3.5, fill: 'none', linecap: 'round', shadow: true },
  'neon': { name: '霓虹发光', type: 'svg', lib: SVG_PATHS, stroke: 2.5, fill: 'none', linecap: 'round', glow: true },
  'neon-strong': { name: '强光霓虹', type: 'svg', lib: SVG_PATHS, stroke: 3, fill: 'none', linecap: 'round', glowStrong: true },
  'hollow': { name: '空心轮廓', type: 'svg', lib: SVG_PATHS, stroke: 1.5, fill: 'none', linecap: 'round', linejoin: 'round' },
  'filled': { name: '实心填充', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'currentColor' },
  'duotone': { name: '双色调', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'currentColor', fillOpacity: 0.3 },
  'mini-filled': { name: '迷你实心', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'currentColor', size: 12 },
  'large-filled': { name: '大号实心', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'currentColor', size: 22 },
  'mini': { name: '迷你图标', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', size: 12 },
  'small': { name: '小号图标', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', size: 14 },
  'medium': { name: '中号图标', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', size: 18 },
  'large': { name: '大号图标', type: 'svg', lib: SVG_PATHS, stroke: 2.5, fill: 'none', size: 22 },
  'xlarge': { name: '超大图标', type: 'svg', lib: SVG_PATHS, stroke: 2.5, fill: 'none', size: 26 },
  'rounded-bold': { name: '圆角粗线', type: 'svg', lib: SVG_PATHS, stroke: 4, fill: 'none', linecap: 'round', linejoin: 'round' },
  'square-thin': { name: '直角细线', type: 'svg', lib: SVG_PATHS, stroke: 1, fill: 'none', linecap: 'square', linejoin: 'miter' },
  'rounded-mini': { name: '圆角迷你', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'none', linecap: 'round', size: 12 },
  'circle-bg-green': { name: '绿底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#22c55e', bgType: 'circle' },
  'circle-bg-blue': { name: '蓝底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#3b82f6', bgType: 'circle' },
  'circle-bg-purple': { name: '紫底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#a855f7', bgType: 'circle' },
  'circle-bg-pink': { name: '粉底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#ec4899', bgType: 'circle' },
  'circle-bg-orange': { name: '橙底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#f97316', bgType: 'circle' },
  'circle-bg-red': { name: '红底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#ef4444', bgType: 'circle' },
  'circle-bg-cyan': { name: '青底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#06b6d4', bgType: 'circle' },
  'circle-bg-yellow': { name: '黄底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#eab308', bgType: 'circle' },
  'circle-bg-dark': { name: '暗底圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#334155', bgType: 'circle' },
  'circle-bg-glass': { name: '玻璃圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: 'rgba(255,255,255,0.15)', bgType: 'circle' },
  'circle-bg-indigo': { name: '靛蓝圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#6366f1', bgType: 'circle' },
  'circle-bg-rose': { name: '玫瑰圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#f43f5e', bgType: 'circle' },
  'circle-bg-teal': { name: '青色圆形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#14b8a6', bgType: 'circle' },
  'square-bg-green': { name: '绿底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#22c55e', bgType: 'square' },
  'square-bg-blue': { name: '蓝底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#3b82f6', bgType: 'square' },
  'square-bg-purple': { name: '紫底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#a855f7', bgType: 'square' },
  'square-bg-pink': { name: '粉底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#ec4899', bgType: 'square' },
  'square-bg-orange': { name: '橙底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#f97316', bgType: 'square' },
  'square-bg-red': { name: '红底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#ef4444', bgType: 'square' },
  'square-bg-cyan': { name: '青底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#06b6d4', bgType: 'square' },
  'square-bg-yellow': { name: '黄底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#eab308', bgType: 'square' },
  'square-bg-dark': { name: '暗底方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#334155', bgType: 'square' },
  'square-bg-glass': { name: '玻璃方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: 'rgba(255,255,255,0.15)', bgType: 'square' },
  'square-bg-indigo': { name: '靛蓝方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#6366f1', bgType: 'square' },
  'square-bg-rose': { name: '玫瑰方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#f43f5e', bgType: 'square' },
  'square-bg-teal': { name: '青色方形', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#fff', bg: '#14b8a6', bgType: 'square' },
  'outline-circle-green': { name: '绿色圆框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#22c55e', bg: 'transparent', border: '#22c55e', bgType: 'circle' },
  'outline-circle-blue': { name: '蓝色圆框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#3b82f6', bg: 'transparent', border: '#3b82f6', bgType: 'circle' },
  'outline-circle-purple': { name: '紫色圆框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#a855f7', bg: 'transparent', border: '#a855f7', bgType: 'circle' },
  'outline-circle-pink': { name: '粉色圆框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#ec4899', bg: 'transparent', border: '#ec4899', bgType: 'circle' },
  'outline-square-green': { name: '绿色方框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#22c55e', bg: 'transparent', border: '#22c55e', bgType: 'square' },
  'outline-square-blue': { name: '蓝色方框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#3b82f6', bg: 'transparent', border: '#3b82f6', bgType: 'square' },
  'outline-square-purple': { name: '紫色方框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#a855f7', bg: 'transparent', border: '#a855f7', bgType: 'square' },
  'outline-square-pink': { name: '粉色方框', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: '#ec4899', bg: 'transparent', border: '#ec4899', bgType: 'square' },
  'gradient-green': { name: '绿蓝渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#4ade80', '#3b82f6'] },
  'gradient-purple': { name: '紫罗兰渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#c084fc', '#6366f1'] },
  'gradient-sunset': { name: '日落渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#f97316', '#ec4899'] },
  'gradient-gold': { name: '金色渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#facc15', '#f97316'] },
  'gradient-ocean': { name: '海洋渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#06b6d4', '#3b82f6'] },
  'gradient-forest': { name: '森林渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#22c55e', '#166534'] },
  'gradient-fire': { name: '火焰渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#ef4444', '#f97316'] },
  'gradient-sky': { name: '天空渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#38bdf8', '#ffffff'] },
  'gradient-night': { name: '暗夜渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#475569', '#0f172a'] },
  'gradient-candy': { name: '糖果渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#f472b6', '#c084fc'] },
  'gradient-mint': { name: '薄荷渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#2dd4bf', '#06b6d4'] },
  'gradient-lemon': { name: '柠檬渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#facc15', '#22c55e'] },
  'gradient-cherry': { name: '樱桃渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#e11d48', '#881337'] },
  'gradient-deep': { name: '深海渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#1e3a8a', '#4c1d95'] },
  'gradient-rainbow': { name: '彩虹渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7'] },
  'gradient-shadow': { name: '渐变投影', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#4ade80', '#3b82f6'], shadow: true },
  'gradient-glow': { name: '渐变发光', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#c084fc', '#6366f1'], glow: true },
  'gradient-dashed': { name: '渐变虚线', type: 'svg', lib: SVG_PATHS, stroke: 2, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#f97316', '#ec4899'], dasharray: '4 2' },
  'gradient-bold': { name: '渐变粗线', type: 'svg', lib: SVG_PATHS, stroke: 3, fill: 'none', gradient: true, gradientColors: ['#facc15', '#f97316'] },
  'gradient-thin': { name: '渐变细线', type: 'svg', lib: SVG_PATHS, stroke: 1, fill: 'none', gradient: true, gradientColors: ['#06b6d4', '#3b82f6'] },
  'gradient-mini': { name: '渐变迷你', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#22c55e', '#166534'], size: 12 },
  'gradient-large': { name: '渐变大号', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#ef4444', '#f97316'], size: 22 },
  'gradient-double': { name: '渐变双线', type: 'svg', lib: SVG_PATHS, stroke: 3.5, fill: 'none', gradient: true, gradientColors: ['#38bdf8', '#ffffff'], doubleLine: true },
  'gradient-pink-blue': { name: '粉蓝渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#ec4899', '#3b82f6'] },
  'gradient-green-yellow': { name: '绿黄渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#22c55e', '#eab308'] },
  'gradient-purple-pink': { name: '紫粉渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#a855f7', '#ec4899'] },
  'gradient-orange-yellow': { name: '橙黄渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#f97316', '#facc15'] },
  'gradient-blue-cyan': { name: '蓝青渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#3b82f6', '#06b6d4'] },
  'gradient-crimson': { name: '绯红渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#ef4444', '#881337'] },
  'gradient-lavender': { name: '薰衣草渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#c084fc', '#e9d5ff'] },
  'gradient-mint-green': { name: '薄荷绿渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#2dd4bf', '#22c55e'] },
  'gradient-sunshine': { name: '阳光渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#facc15', '#f97316'] },
  'gradient-twilight': { name: '暮光渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#6366f1', '#1e1b4b'] },
  'gradient-aurora': { name: '极光渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#2dd4bf', '#a855f7', '#3b82f6'] },
  'gradient-nebula': { name: '星云渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#ec4899', '#8b5cf6', '#06b6d4'] },
  'gradient-lake': { name: '湖水渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#38bdf8', '#2dd4bf', '#4ade80'] },
  'gradient-lava': { name: '岩浆渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#facc15', '#f97316', '#ef4444'] },
  'gradient-peach': { name: '蜜桃渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#fda4af', '#fecdd3', '#fed7aa'] },
  'gradient-violet': { name: '紫罗兰渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#8b5cf6', '#d8b4fe', '#f472b6'] },
  'gradient-matrix': { name: '矩阵渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#22c55e', '#166534', '#052e16'] },
  'gradient-sakura': { name: '樱花渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#fbcfe8', '#f9a8d4', '#ec4899'] },
  'gradient-steel': { name: '钢铁渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#94a3b8', '#475569', '#1e293b'] },
  'gradient-desert': { name: '沙漠渐变', type: 'svg', lib: SVG_PATHS, stroke: 0, fill: 'url(#ufiGradient)', gradient: true, gradientColors: ['#fcd34d', '#f97316', '#b45309'] },
  'rainbow-color': { name: '彩虹彩色', type: 'svg', lib: SVG_PATHS, stroke: 2.5, rainbow: true }
};

const applyIcons = () => {
  if (currentStyle === 'system') return;
  const styleData = STYLE_LIBS[currentStyle] || STYLE_LIBS['material'];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let textNode;
  const nodesToProcess = [];
  while (textNode = walker.nextNode()) {
    const rawText = textNode.textContent || '';
    const trimmedText = rawText.replace(/[\s\u200b]/g, '').trim();
    if (!trimmedText || trimmedText.length > 30) continue;
    let matchedKey = null;
    const lowerText = trimmedText.toLowerCase();
    for (const key in ICON_MAP) {
      const lowerKey = key.toLowerCase();
      if (lowerText === lowerKey) { matchedKey = ICON_MAP[key]; break; }
      if (lowerText.indexOf(lowerKey + ':') === 0) { matchedKey = ICON_MAP[key]; break; }
      if (lowerText.indexOf(lowerKey + '：') === 0) { matchedKey = ICON_MAP[key]; break; }
      if (lowerKey === '卡状态' && lowerText.indexOf('卡状态') === 0) { matchedKey = ICON_MAP['卡状态']; break; }
    }
    if (matchedKey) {
      const parentEl = textNode.parentNode;
      const isInsideModal = parentEl && (parentEl.closest('.modal') || parentEl.closest('[class*="modal"]') || parentEl.closest('#' + MODAL));
      const isInput = parentEl && (parentEl.tagName === 'INPUT' || parentEl.tagName === 'TEXTAREA');
      if (parentEl && !isInsideModal && !isInput && !parentEl.querySelector('.ufi-skin-icon')) {
        nodesToProcess.push({ node: textNode, parent: parentEl, key: matchedKey });
      }
    }
  }
  nodesToProcess.forEach(item => {
    let iconEl;
    if (styleData.type === 'emoji') {
      iconEl = document.createElement('span');
      iconEl.textContent = styleData.lib[item.key] || '•';
      iconEl.style.marginRight = '6px';
      iconEl.style.fontSize = '1.1em';
      iconEl.style.display = 'inline-block';
      iconEl.style.verticalAlign = 'middle';
      iconEl.style.flexShrink = '0';
    } else {
      const svgPath = styleData.lib[item.key];
      if (!svgPath) return;
      iconEl = document.createElement('span');
      const size = styleData.size || 16;
      let svgStyle = `width:${size}px;height:${size}px;display:inline-block;vertical-align:middle;flex-shrink:0;`;
      if (styleData.glow) svgStyle += `filter: drop-shadow(0 0 2px currentColor);`;
      if (styleData.glowStrong) svgStyle += `filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 6px currentColor);`;
      if (styleData.shadow) svgStyle += `filter: drop-shadow(0 1px 1px rgba(0,0,0,0.5));`;
      if (styleData.doubleLine) svgStyle += `filter: drop-shadow(0 0 1px rgba(0,0,0,0.8)) drop-shadow(0 0 1px rgba(255,255,255,0.5));`;
      let defs = '';
      let fill = styleData.fill || 'none';
      let strokeColor = 'currentColor';
      let bgColor = styleData.bg || '';
      let bgType = styleData.bgType;
      let borderColor = styleData.border || '';
      
      if (styleData.gradient) {
        const gid = 'ufiGrad_' + Math.random().toString(36).substr(2, 9);
        const colors = styleData.gradientColors || ['#4ade80', '#3b82f6'];
        const stops = colors.map((c, i) => `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="${c}" />`).join('');
        defs = `<defs><linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%">${stops}</linearGradient></defs>`;
        fill = `url(#${gid})`;
      }
      
      if (colorfulMode) {
        const funcColor = COLOR_MAP[item.key] || '#3b82f6';
        bgColor = funcColor;
        if (!bgType) bgType = 'square';
        borderColor = '';
        strokeColor = '#ffffff';
        fill = 'none';
      }
      
      iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="${fill}" fill-opacity="${styleData.fillOpacity || 1}" stroke="${strokeColor}" stroke-width="${styleData.stroke || 2}" stroke-linecap="${styleData.linecap || 'round'}" stroke-linejoin="${styleData.linejoin || 'round'}" ${styleData.dasharray ? `stroke-dasharray="${styleData.dasharray}"` : ''} style="${svgStyle}">${defs}${svgPath}</svg>`;
      
      if (bgColor || borderColor) {
        iconEl.style.display = 'inline-flex';
        iconEl.style.alignItems = 'center';
        iconEl.style.justifyContent = 'center';
        iconEl.style.width = '18px';
        iconEl.style.height = '18px';
        iconEl.style.flexShrink = '0';
        iconEl.style.borderRadius = bgType === 'circle' ? '50%' : '4px';
        if (bgColor) iconEl.style.background = bgColor;
        if (borderColor) iconEl.style.border = '1.5px solid ' + borderColor;
        iconEl.style.marginRight = '6px';
        iconEl.style.verticalAlign = 'middle';
      } else if (!colorfulMode) {
        iconEl.style.marginRight = '6px';
        iconEl.style.display = 'inline-block';
        iconEl.style.verticalAlign = 'middle';
        iconEl.style.flexShrink = '0';
      }
    }
    iconEl.className = 'ufi-skin-icon';
    iconEl.style.pointerEvents = 'none';
    iconEl.style.userSelect = 'none';
    try {
      let inserted = false;
      const parent = item.parent;
      if (parent.tagName === 'SELECT' || parent.tagName === 'OPTION') {
        const wrapper = parent.parentNode;
        if (wrapper && !wrapper.querySelector('.ufi-skin-icon')) {
          wrapper.insertBefore(iconEl, parent);
          inserted = true;
        }
      }
      if (!inserted) {
        for (let i = 0; i < parent.childNodes.length; i++) {
          if (parent.childNodes[i].nodeType === 3) {
            parent.insertBefore(iconEl, parent.childNodes[i]);
            inserted = true;
            break;
          }
        }
      }
      if (!inserted) {
        parent.insertBefore(iconEl, parent.firstChild);
      }
    } catch (e) {}
  });
};

const insertTitleLogo = () => {
  if (currentStyle === 'system') return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text.indexOf('UFI-TOOLS') !== -1) {
      const parent = node.parentNode;
      if (parent && !parent.querySelector('.ufi-title-logo') && !parent.closest('#' + MODAL) && !parent.closest('.modal')) {
        const img = document.createElement('img');
        img.src = logoUrl;
        img.className = 'ufi-title-logo';
        img.style.width = '22px';
        img.style.height = '22px';
        img.style.verticalAlign = 'middle';
        img.style.marginRight = '8px';
        img.style.borderRadius = '6px';
        img.style.flexShrink = '0';
        img.style.pointerEvents = 'none';
        parent.insertBefore(img, node);
      }
    }
  }
};

const ensureStyle = () => {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
#${MODAL} .confirm-box { padding: 16px 10px; text-align: center; }
#${MODAL} .confirm-box .title { margin-bottom: 14px; font-size: .85rem; color: #eaeaf2; }
#${MODAL} .confirm-box .btns { display: flex; gap: 10px; justify-content: center; }
#${MODAL} .confirm-box button { padding: 8px 16px; border-radius: 8px; border: none; font-size: .75rem; cursor: pointer; font-weight: bold; }
#${MODAL} .confirm-box .yes { background: #4ade80; color: #000; }
#${MODAL} .confirm-box .no { background: rgba(255,255,255,.1); color: #fff; }
@media (max-width: 400px) { #${MODAL} div[style*="grid-template-columns"] { grid-template-columns: 1fr 1fr !important; } }
`;
  document.head.appendChild(el);
};

const renderUI = () => {
  const colorPalette = ['#f43f5e', '#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#06b6d4', '#ec4899', '#f97316', '#6366f1', '#14b8a6'];
  const styleKeys = Object.keys(STYLE_LIBS);
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:0 4px;">
    <span style="color:#94a3b8;font-size:.85rem;">当前共有 <b>${styleKeys.length}</b> 种主题</span>
    <span style="display:flex;align-items:center;gap:6px;color:#94a3b8;font-size:.8rem;">
      彩色模式
      <span id="ufi_color_toggle" style="display:inline-block;width:40px;height:22px;border-radius:11px;background:${colorfulMode ? '#4ade80' : '#334155'};position:relative;cursor:pointer;transition:background .2s;">
        <span style="position:absolute;top:2px;left:${colorfulMode ? '20px' : '2px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left .2s;"></span>
      </span>
    </span>
  </div>`;
  html += `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">`;
  for (let i = 0; i < styleKeys.length; i++) {
    const key = styleKeys[i];
    const s = STYLE_LIBS[key];
    const isActive = key === currentStyle;
    let sPreview = '';
    if (s.type === 'none') {
      sPreview = '<span style="font-size:16px;opacity:.5;">--</span>';
    } else if (s.type === 'emoji') {
      sPreview = s.lib['settings'] || '⚙️';
    } else {
      const size = 24;
      let defs = '';
      let fill = s.fill || 'none';
      let previewStroke = 'currentColor';
      let previewBg = '';
      let previewBgType = s.bgType;
      
      if (colorfulMode) {
        previewStroke = '#ffffff';
        previewBg = colorPalette[i % colorPalette.length];
        fill = 'none';
        if (!previewBgType) previewBgType = 'square';
      } else if (s.gradient) {
        const gid = 'ufiGradPrev_' + Math.random().toString(36).substr(2, 9);
        const colors = s.gradientColors || ['#4ade80', '#3b82f6'];
        const stops = colors.map((c, idx) => `<stop offset="${(idx / (colors.length - 1)) * 100}%" stop-color="${c}" />`).join('');
        defs = `<defs><linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%">${stops}</linearGradient></defs>`;
        fill = `url(#${gid})`;
      }
      let prevStyle = `width:${size}px;height:${size}px;`;
      if (s.glow) prevStyle += `filter: drop-shadow(0 0 2px currentColor);`;
      if (s.glowStrong) prevStyle += `filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 6px currentColor);`;
      if (s.shadow) prevStyle += `filter: drop-shadow(0 1px 1px rgba(0,0,0,0.5));`;
      if (s.doubleLine) prevStyle += `filter: drop-shadow(0 0 1px rgba(0,0,0,0.8)) drop-shadow(0 0 1px rgba(255,255,255,0.5));`;
      sPreview = `<svg viewBox="0 0 24 24" fill="${fill}" fill-opacity="${s.fillOpacity || 1}" stroke="${previewStroke}" stroke-width="${s.stroke || 2}" stroke-linecap="${s.linecap || 'round'}" stroke-linejoin="${s.linejoin || 'round'}" ${s.dasharray ? `stroke-dasharray="${s.dasharray}"` : ''} style="${prevStyle}">${defs}${s.lib['settings'] || ''}</svg>`;
      
      if (colorfulMode && previewBg) {
        let br = '6px';
        if (previewBgType === 'circle') br = '50%';
        else if (previewBgType === 'square') br = '4px';
        sPreview = `<div style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:${br};background:${previewBg};box-shadow:0 2px 6px rgba(0,0,0,0.3);">${sPreview}</div>`;
      } else if (s.bg || s.border) {
        let bgStyle = `display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:${s.bgType === 'circle' ? '50%' : '6px'};`;
        if (s.bg) bgStyle += `background:${s.bg};`;
        if (s.border) bgStyle += `border:2px solid ${s.border};`;
        sPreview = `<div style="${bgStyle}">${sPreview}</div>`;
      }
    }
    html += `<div class="skin-card" data-style="${key}" style="border:2px solid ${isActive ? '#4ade80' : 'rgba(255,255,255,.1)'};border-radius:12px;padding:12px 6px;cursor:pointer;text-align:center;background:${isActive ? 'rgba(74,222,128,.1)' : 'rgba(255,255,255,.03)'};transition:all .2s;">
      <div style="height:32px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;">${sPreview}</div>
      <div style="color:#ccc;font-size:.7rem;line-height:1.2;">${s.name}</div>
      ${isActive ? '<div style="font-size:.55rem;background:#4ade80;color:#000;padding:2px 6px;border-radius:8px;margin-top:6px;display:inline-block;">使用中</div>' : ''}
    </div>`;
  }
  html += `</div>`;
  return html;
};

const bindUI = (el) => {
  const colorToggle = el.querySelector('#ufi_color_toggle');
  if (colorToggle) {
    colorToggle.onclick = () => {
      colorfulMode = !colorfulMode;
      localStorage.setItem(COLOR_KEY, colorfulMode);
      location.reload();
    };
  }
  el.querySelectorAll('.skin-card').forEach(card => {
    card.addEventListener('click', () => {
      const styleKey = card.getAttribute('data-style');
      if (styleKey === currentStyle) return;
      const box = document.querySelector('#' + MODAL + ' .content');
      if (!box) return;
      const originalHtml = box.innerHTML;
      box.innerHTML = `
        <div class="confirm-box">
          <div class="title">确定要切换为 <b style="color:#4ade80">${STYLE_LIBS[styleKey].name}</b> 吗？<br><span style="font-size:.65rem;opacity:.6">确认后页面将自动刷新</span></div>
          <div class="btns">
            <button class="yes" id="ufi_skin_yes">确认切换</button>
            <button class="no" id="ufi_skin_no">取消</button>
          </div>
        </div>
      `;
      document.getElementById('ufi_skin_yes').onclick = () => {
        localStorage.setItem(STORE_KEY, styleKey);
        location.reload();
      };
      document.getElementById('ufi_skin_no').onclick = () => {
        box.innerHTML = originalHtml;
        bindUI(box);
      };
    });
  });
};

const initObserver = () => {
  applyIcons();
  insertTitleLogo();
  observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    for (let i = 0; i < mutations.length; i++) {
      if (mutations[i].addedNodes.length > 0) {
        shouldUpdate = true;
        break;
      }
    }
    if (shouldUpdate) {
      requestAnimationFrame(() => {
        applyIcons();
        insertTitleLogo();
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
};

const pauseObserver = () => {
  if (observer) { observer.disconnect(); observer = null; }
};

const resumeObserver = () => {
  if (!observer) { initObserver(); }
};

ensureStyle();
initObserver();

const openModal = () => {
  const hasUpdate = _manifest && _manifest.version && _manifest.version !== _PREV_VER;
  let titleHtml = '<span style="font-size:1.05rem;">🎨 shbay主题风格插件</span> <span style="font-size:.65rem;opacity:.6;font-weight:normal;margin-left:6px;">v' + _PREV_VER + '</span>';
  if (hasUpdate) {
    titleHtml += ' <span id="ufi-title-update" style="display:inline-flex;align-items:center;gap:4px;margin-left:6px;font-size:.65rem;color:#4ade80;cursor:pointer;font-weight:normal;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4ade80;box-shadow:0 0 4px #4ade80;"></span>有新版本！</span>';
  }

  const { el, id } = createModal({
    name: MODAL,
    title: titleHtml,
    content: renderUI(),
    showConfirm: false,
    maxWidth: '380px',
    contentStyle: 'max-height: 60vh; overflow-y: auto;',
    onClose: () => { resumeObserver(); return true; }
  });
  pauseObserver();
  showModal(id);
  
  const updateBtn = el.querySelector('#ufi-title-update');
  if (updateBtn) {
    updateBtn.onclick = () => _performUpdateFlow();
  }
  
  bindUI(el);
};

const mainBtn = document.createElement('button');
mainBtn.textContent = '主题风格';
mainBtn.onclick = openModal;
document.querySelector('.actions-buttons')?.appendChild(mainBtn);

// 启动时自动检查更新
setTimeout(() => { _checkUpdateInBackground(); }, 3000);

})();
</script>

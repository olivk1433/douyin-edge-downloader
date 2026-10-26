export function isDouyinPage(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['www.douyin.com', 'douyin.com'].includes(u.hostname); }
  catch { return false; }
}

export function mediaURL(value) {
  if (typeof value !== 'string') return '';
  try {
    const u = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (u.protocol !== 'https:' || u.username || u.password || /\.(m3u8|mpd)(?:$|\/)/i.test(u.pathname)) return '';
    return u.href;
  } catch { return ''; }
}

export function filenameFor(item) {
  const clean = String(item.title || '抖音视频').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '');
  let name = [...clean].slice(0, 64).join('').replace(/[. ]+$/g, '') || '抖音视频';
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  const id = /^\d{5,30}$/.test(item.id || '') ? item.id : '当前视频';
  return `Douyin/${name}_${id}.mp4`;
}

export function sameVideo(a, b) {
  if (!a || !b || a.status !== 'ready' || b.status !== 'ready') return false;
  // Even an unchanged route ID may be stale during a SPA player switch.
  if(a.id && b.id && a.id!==b.id)return false;
  if(a.id && b.id && a.playerSource && b.playerSource)return a.playerSource===b.playerSource;
  return a.url === b.url;
}

export function downloadError(reason = 'UNKNOWN') {
  const messages = {
    SERVER_FORBIDDEN:'媒体服务器拒绝访问', SERVER_UNAUTHORIZED:'媒体服务器要求验证身份',
    SERVER_CROSS_ORIGIN_REDIRECT:'下载重定向被浏览器阻止', SERVER_BAD_CONTENT:'服务器返回的内容不可用',
    SERVER_FAILED:'媒体服务器请求失败', SERVER_UNREACHABLE:'无法连接媒体服务器',
    SERVER_NO_RANGE:'服务器不支持断点续传', SERVER_CONTENT_LENGTH_MISMATCH:'服务器返回的文件长度不一致',
    SERVER_CERT_PROBLEM:'媒体服务器的证书存在问题', NETWORK_FAILED:'网络请求失败',
    NETWORK_TIMEOUT:'网络请求超时', NETWORK_DISCONNECTED:'网络连接已断开',
    NETWORK_SERVER_DOWN:'媒体服务器暂时不可用', NETWORK_INVALID_REQUEST:'下载请求被浏览器拒绝',
    FILE_NO_SPACE:'磁盘空间不足', FILE_ACCESS_DENIED:'没有权限写入下载目录',
    FILE_NAME_TOO_LONG:'保存文件名过长', FILE_TOO_LARGE:'文件超过本地文件系统限制',
    FILE_BLOCKED:'文件被浏览器或系统阻止', FILE_VIRUS_INFECTED:'安全检查阻止了文件',
    FILE_SECURITY_CHECK_FAILED:'文件安全检查失败', FILE_FAILED:'本地文件保存失败',
    USER_CANCELED:'下载已取消', USER_SHUTDOWN:'浏览器关闭导致下载停止', CRASH:'浏览器异常退出'
  };
  return `${messages[reason] || '下载中断'}（${reason}）`;
}

export function canRetryInPage(reason) {
  return ['SERVER_FORBIDDEN','SERVER_UNAUTHORIZED','SERVER_CROSS_ORIGIN_REDIRECT',
    'SERVER_BAD_CONTENT','SERVER_FAILED','SERVER_NO_RANGE','NETWORK_INVALID_REQUEST',
    'NETWORK_FAILED','SERVER_CONTENT_LENGTH_MISMATCH'].includes(reason);
}

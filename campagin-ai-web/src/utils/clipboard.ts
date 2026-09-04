/**
 * 复制到剪贴板，带兜底。
 *
 * navigator.clipboard 需要安全上下文（secure context）。`http://localhost`
 * 算安全上下文所以本机开发没问题，但一旦换成局域网 IP 走纯 http 访问，
 * navigator.clipboard 直接是 undefined —— 所以必须保留隐藏 textarea +
 * document.execCommand("copy") 这条老路。
 *
 * 返回 false 表示两条路都失败，调用方应提示用户手动选择复制。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 用户拒绝权限、或页面失焦时会抛，继续走兜底。
    }
  }

  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  // 不能用 display:none / visibility:hidden —— 那样 select() 选不中。
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    // execCommand 已废弃但仍是非安全上下文下唯一可用的同步复制手段。
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

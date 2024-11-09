const PASSWORD = "abc123";  // 设置预定义的密码
const PASSWORD_COOKIE_NAME = "password_verified";  // 存储验证状态的 Cookie 名称
const PROXY_HOSTNAME_COOKIE_NAME = "proxy_hostname";  // 存储代理主机名的 Cookie 名称

function logError(request, message) {
  console.error(
    `${message}, clientIp: ${request.headers.get(
      "cf-connecting-ip"
    )}, user-agent: ${request.headers.get("user-agent")}, url: ${request.url}`
  );
}

function createNewRequest(request, url, proxyHostname, originHostname) {
  const newRequestHeaders = new Headers(request.headers);
  for (const [key, value] of newRequestHeaders) {
    if (value.includes(originHostname)) {
      newRequestHeaders.set(
        key,
        value.replace(
          new RegExp(`(?<!\\.)\\b${originHostname}\\b`, "g"),
          proxyHostname
        )
      );
    }
  }
  return new Request(url.toString(), {
    method: request.method,
    headers: newRequestHeaders,
    body: request.body,
  });
}

function applyStringReplacements(text, replacements) {
  // 遍历替换规则数组，逐个替换
  replacements.forEach(({ search, replace }) => {
    const regex = new RegExp(search, 'g');  // 全局替换
    text = text.replace(regex, replace);
  });
  return text;
}

function setResponseHeaders(
  originalResponse,
  proxyHostname,
  originHostname,
  DEBUG
) {
  const newResponseHeaders = new Headers(originalResponse.headers);
  for (const [key, value] of newResponseHeaders) {
    if (value.includes(proxyHostname)) {
      newResponseHeaders.set(
        key,
        value.replace(
          new RegExp(`(?<!\\.)\\b${proxyHostname}\\b`, "g"),
          originHostname
        )
      );
    }
  }
  if (DEBUG) {
    newResponseHeaders.delete("content-security-policy");
  }
  return newResponseHeaders;
}

/**
 * 替换内容
 * @param originalResponse 响应
 * @param proxyHostname 代理地址 hostname
 * @param pathnameRegex 代理地址路径匹配的正则表达式
 * @param originHostname 替换的字符串
 * @returns {Promise<*>}
 */
async function replaceResponseText(
  originalResponse,
  proxyHostname,
  pathnameRegex,
  originHostname
) {
  let text = await originalResponse.text();
  if (pathnameRegex) {
    pathnameRegex = pathnameRegex.replace(/^\^/, "");
    return text.replace(
      new RegExp(`((?<!\\.)\\b${proxyHostname}\\b)(${pathnameRegex})`, "g"),
      `${originHostname}\$2`
    );
  } else {
    return text.replace(
      new RegExp(`(?<!\\.)\\b${proxyHostname}\\b`, "g"),
      originHostname
    );
  }
}

async function nginx() {
  return `<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
html { color-scheme: light dark; }
body { width: 35em; margin: 0 auto;
font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and
working. Further configuration is required.</p>

<p>For online documentation and support please refer to
<a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at
<a href="http://nginx.com/">nginx.com</a>.</p>

<p><em>Thank you for using nginx.</em></p>
</body>
</html>`;
}
// 返回密码输入框的 HTML 页面
function getPasswordPage() {
  return `<!DOCTYPE html> <html> <head> <title>Password Required</title> <style> body { font-family: Arial, sans-serif; padding: 20px; } h2 { color: #333; } input[type="password"] { padding: 10px; font-size: 16px; width: 200px; } button { padding: 10px 20px; font-size: 16px; cursor: pointer; } </style> </head> <body> <h2>Enter Password</h2> <form method="POST" action="/">   <input type="password" name="password" required />   <button type="submit">Submit</button> </form> <p>密码是a开头6位</p> </body> </html>`;
}
// 返回更换源站输入框的 HTML 页面，并通过 JavaScript 设置 cookie
function getChangeProxyHostnamePage(currentHostname) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Change Proxy Hostname</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h2 { color: #333; }
    input[type="text"] { padding: 10px; font-size: 16px; width: 200px; }
    button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
  </style>
  <script>
    // 当表单提交时，设置 cookie
    function setProxyHostnameCookie() {
      const proxyHostname = document.getElementById("proxy_hostname").value;
      document.cookie = "proxy_hostname=" + proxy_hostname + "; path=/; HttpOnly; Secure";
      alert("Proxy Hostname Updated: " + proxy_hostname);
      location.reload(); // 刷新页面，以便更新当前代理主机名
    }
  </script>
</head>
<body>
  <h2>Enter New Proxy Hostname</h2>
  <form onsubmit="setProxyHostnameCookie();">
    <input type="text" id="proxyHostname" name="proxy_hostname" value="${currentHostname}" required />
    <button type="submit">Submit</button>
  </form>
  <p>当前代理主机名: ${currentHostname}    list:searx.space</p>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    try {
      // 获取 Cookie 中的 proxy_hostname，若没有则使用默认值
      const cookies = request.headers.get("cookie") || "";
      let proxyHostname = cookies.match(/(?:^|;)\s*proxy_hostname=([^;]+)/);
      proxyHostname = proxyHostname ? proxyHostname[1] : "baresearch.sssss";
      const {
        PROXY_PROTOCOL = "https",
        PATHNAME_REGEX,
        UA_WHITELIST_REGEX,
        UA_BLACKLIST_REGEX,
        URL302,
        IP_WHITELIST_REGEX,
        IP_BLACKLIST_REGEX,
        REGION_WHITELIST_REGEX,
        REGION_BLACKLIST_REGEX,
        DEBUG = false,
        STRING_REPLACEMENTS = '[{"search":"</footer>","replace":"<p>by dev.leiyanhui.com,list:searx.space,</footer>"},{"search":"oldstring2","replace":"newstring2"}]',
      } = env;

      // 检查用户是否通过密码验证
      const passwordVerified = cookies.includes(`${PASSWORD_COOKIE_NAME}=true`);
      
      // 如果用户未验证密码，则返回密码输入页面
      if (!passwordVerified) {
        if (request.method === "POST") {
          const formData = await request.formData();
          const password = formData.get("password");

          if (password === PASSWORD) {
            // 设置 cookie 表示密码验证通过
            return new Response("Password verified,请刷新页面", {
              status: 200,
              headers: {
                "Set-Cookie": `${PASSWORD_COOKIE_NAME}=true; Path=/; HttpOnly; Secure`,
                "Content-Type": "text/html; charset=utf-8",
              },
            });
          } else {
            return new Response("Incorrect password", { status: 403 });
          }
        }

        return new Response(getPasswordPage(), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // 检查代理主机是否可用
      const url = new URL(request.url);
      const originHostname = url.hostname;

      // 如果代理主机无法访问，返回更换源站的页面
      try {
        const testResponse = await fetch(`${PROXY_PROTOCOL}://${proxyHostname}`);
        if (!testResponse.ok) {
          throw new Error('Proxy unavailable');
        }
      } catch (error) {
        return new Response(getChangeProxyHostnamePage(proxyHostname), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // 处理代理请求
      const newRequest = createNewRequest(request, url, proxyHostname, originHostname);
      const originalResponse = await fetch(newRequest);
      const newResponseHeaders = setResponseHeaders(
        originalResponse,
        proxyHostname,
        originHostname,
        DEBUG
      );
      const contentType = newResponseHeaders.get("content-type") || "";
      let body;
      if (contentType.includes("text/")) {
        body = await replaceResponseText(originalResponse, proxyHostname, PATHNAME_REGEX, originHostname);

        // 应用字符串替换规则
        const replacements = STRING_REPLACEMENTS ? JSON.parse(STRING_REPLACEMENTS) : [];
        if (replacements.length > 0) {
          body = applyStringReplacements(body, replacements);
        }
      } else {
        body = originalResponse.body;
      }
      return new Response(body, {
        status: originalResponse.status,
        headers: newResponseHeaders,
      });
    } catch (error) {
      logError(request, `Fetch error: ${error.message}`);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

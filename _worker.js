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

async function passwordPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Required</title>
</head>
<body>
  <h1>Enter Password</h1>
  <form method="POST" action="/passwd">
    <label for="password">Password:</label>
    <input type="password" id="password" name="password" required />
    <button type="submit">Submit</button>
    <p> passwd is : a****3 </p> 
    <p>password:str.len == 6 </p>
</html>`;
}


async function changeSourcePage(currentSource) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Change Source</title>
</head>
<body>
  <h1>修改反代源地</h1>
  <form method="POST" action="/changesource">
    <label for="proxyHostname">New Proxy Source URL:</label>
    <input type="text" id="proxyHostname" name="proxyHostname" value="${currentSource}" required />
     <p> 不用填写https:// 不能填写本站地址  </p>
    <button type="submit">Change Source</button>
    <p> searxng list: https://searx.space/  可以从这里获得更多 </p>
    <p> 例如：  </p>
    <p> opnxng.com </p>
    <p> baresearch.org  （默认）</p>
    <p> priv.au  </p>
    <p> searx.be  </p>
    <p> etsi.me  copp.gg   fairsuch.net    </p>
    <p> 还有跟多，自己访问https://searx.space/ 获取 不  </p>
  </form>
</body>
</html>`;
}

async function setProxyHostnameCookie(response, proxyHostname) {
  const cookie = `PROXY_HOSTNAME=${proxyHostname}; Max-Age=86400; Path=/`; // Cookie will last 1 day
  response.headers.set('Set-Cookie', cookie);
  return response;
}
async function setPasswordCookie(response, password) {
  const cookie = `password=${password}; Max-Age=86400; Path=/`; // Cookie will last 1 day
  response.headers.set('Set-Cookie', cookie);
  return response;
}

export default {
  async fetch(request, env, ctx) {
    try {
      const {
        PROXY_HOSTNAME = "baresearch.org",
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
        PASSWORD = "abc123", // Replace with your actual password
        REPLACE_STRINGS = [ //正则
        { "regex": "</footer>", "replacement": "<p>leiyanhui.com <a href=/changesource>ChangeSource</a>  joyanhui: <a href=https://github.com/joyanhui/searxng-cf-proxy-worker.js>github</a></p><br>右上角 首选项 可以切换搜索引擎 <br> 底部 ChangeSource 可以更换反代后端 </footer>" },
        { "regex": "<title>SearXNG</title>", "replacement": "<title>聚合搜</title>" },
        { "regex": PROXY_HOSTNAME, "replacement": "so.cf-cdn-ns.work" },
        { "regex": "<form id=\"search\" method=\"POST\" action=\"\/search\" role=\"search\">", "replacement": "<form id=\"search\" method=\"GET\" action=\"\/search\" role=\"search\">" },
        { "regex": "\\bhello\\b", "replacement": "hi" }
        ]
        
      } = env;

      const url = new URL(request.url);
      const originHostname = url.hostname;

      // 获取 cookies 中的密码
      const cookies = request.headers.get('cookie');
      const cookieMap = new Map();
      if (cookies) {
        cookies.split(';').forEach(cookie => {
          const [key, value] = cookie.trim().split('=');
          cookieMap.set(key, value);
        });
      }

      const storedPassword = cookieMap.get('password');
      const storedProxyHostname = cookieMap.get('PROXY_HOSTNAME') || PROXY_HOSTNAME;


      // 如果没有密码，或者密码不正确，则显示密码输入页面。 如果密码配置的是空 那么不执行密码验证
      //if (!storedPassword || storedPassword !== PASSWORD) {
        if (PASSWORD && (!storedPassword || storedPassword !== PASSWORD)) {
        if (request.method === "POST" && request.url.endsWith("/passwd")) {
          // 如果是 /passwd 路径的 POST 请求，处理密码验证
          const formData = await request.formData();
          const password = formData.get('password');
          if (password === PASSWORD) {
            // 密码正确，设置 Cookie 并重定向回原页面
            const response = new Response("Password Correct. Redirecting...", { status: 302 });
            response.headers.set('Location', '/'); // 重定向回原页面
            return setPasswordCookie(response, password);
          } else {
            // 密码错误，返回错误提示
            return new Response("Incorrect Password", { status: 403 });
          }
        } else {
          // 否则显示密码输入页面
          return new Response(await passwordPage(), { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
      }
  // 处理更换源地址页面 /changesource
  if (request.url.endsWith("/changesource")) {
    if (request.method === "POST") {
      const formData = await request.formData();
      const newProxyHostname = formData.get('proxyHostname');
      const response = new Response("Proxy Source Changed. Redirecting...", { status: 302 });
      response.headers.set('Location', '/'); // 重定向回原页面
      return setProxyHostnameCookie(response, newProxyHostname);
    }
    // GET 请求时显示更换源地址页面
    return new Response(await changeSourcePage(storedProxyHostname), { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
      // 验证通过后继续执行代理逻辑
        // 验证通过后继续执行代理逻辑
        if (
          !storedProxyHostname ||
          (PATHNAME_REGEX && !new RegExp(PATHNAME_REGEX).test(url.pathname)) ||
          (UA_WHITELIST_REGEX &&
            !new RegExp(UA_WHITELIST_REGEX).test(
              request.headers.get("user-agent").toLowerCase()
            )) ||
          (UA_BLACKLIST_REGEX &&
            new RegExp(UA_BLACKLIST_REGEX).test(
              request.headers.get("user-agent").toLowerCase()
            )) ||
          (IP_WHITELIST_REGEX &&
            !new RegExp(IP_WHITELIST_REGEX).test(
              request.headers.get("cf-connecting-ip")
            )) ||
          (IP_BLACKLIST_REGEX &&
            new RegExp(IP_BLACKLIST_REGEX).test(
              request.headers.get("cf-connecting-ip")
            )) ||
          (REGION_WHITELIST_REGEX &&
            !new RegExp(REGION_WHITELIST_REGEX).test(
              request.headers.get("cf-ipcountry")
            )) ||
          (REGION_BLACKLIST_REGEX &&
            new RegExp(REGION_BLACKLIST_REGEX).test(
              request.headers.get("cf-ipcountry")
            ))
        ) {
          logError(request, "Invalid");
          return URL302
            ? Response.redirect(URL302, 302)
            : new Response(await nginx(), {
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                },
              });
        }
  
        url.host = storedProxyHostname;
        url.protocol = PROXY_PROTOCOL;
        const newRequest = createNewRequest(
          request,
          url,
          storedProxyHostname,
          originHostname
        );
      // Attempt to fetch the proxy's response
      try {
        const originalResponse = await fetch(newRequest);
        const newResponseHeaders = setResponseHeaders(
          originalResponse,
          PROXY_HOSTNAME,
          originHostname,
          DEBUG
        );
        const contentType = newResponseHeaders.get("content-type") || "";
        let body;
        //处理文本 以及 较为特殊的 application/opensearchdescription+xml; charset=utf-8
        if (contentType.includes("text/") || contentType.includes("opensearchdescription")) {
          body = await replaceResponseText(
            originalResponse,
            PROXY_HOSTNAME,
            PATHNAME_REGEX,
            originHostname
          );

           // Apply multiple replacements from REPLACE_STRINGS
           if (REPLACE_STRINGS.length > 0) {
            REPLACE_STRINGS.forEach((replaceRule) => {
              if (replaceRule && replaceRule.regex && replaceRule.replacement) {
                const regex = new RegExp(replaceRule.regex, "g");
                body = body.replace(regex, replaceRule.replacement);
              }
            });
          }
 


        } else {
          body = originalResponse.body;
        }
        return new Response(body, {
          status: originalResponse.status,
          headers: newResponseHeaders,
        });
      } catch (err) {
        // If fetching the proxy source fails, show the change source page
        logError(request, `Failed to fetch proxy source: ${err.message}`);
        return new Response(await changeSourcePage(storedProxyHostname), {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }
    } catch (e) {
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

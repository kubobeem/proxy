const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const { parse } = require('node-html-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// 初心者へのメモ：このJSをページに埋め込むことで、
// Xのプログラムが「こっそり裏で通信しようとするの」を捕まえて、
// 全部プロキシ経由に変えさせちゃうんだ。これをモンキーパッチって呼ぶよ。
const INJECT_SCRIPT = (proxyHost) => `
<script>
(function() {
    const PROXY_URL = 'https://${proxyHost}/proxy/';
    const originalFetch = window.fetch;
    window.fetch = function() {
        if (arguments[0] && typeof arguments[0] === 'string' && !arguments[0].startsWith('http') && !arguments[0].startsWith(PROXY_URL)) {
            arguments[0] = PROXY_URL + new URL(arguments[0], window.location.href).href;
        } else if (arguments[0] && typeof arguments[0] === 'string' && arguments[0].startsWith('http') && !arguments[0].startsWith(PROXY_URL)) {
             arguments[0] = PROXY_URL + arguments[0];
        }
        return originalFetch.apply(this, arguments);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function() {
        let url = arguments[1];
        if (url && typeof url === 'string' && !url.startsWith('http') && !url.startsWith(PROXY_URL)) {
            arguments[1] = PROXY_URL + new URL(url, window.location.href).href;
        } else if (url && typeof url === 'string' && url.startsWith('http') && !url.startsWith(PROXY_URL)) {
            arguments[1] = PROXY_URL + url;
        }
        return originalOpen.apply(this, arguments);
    };
    console.log('𝕏-Proxy: Communications intercepted.');
})();
</script>
`;

function rewriteUrls(html, proxyHost, targetOrigin) {
    const root = parse(html);
    const proxyPrefix = `https://${proxyHost}/proxy/`;

    // 最初にJSを注入する！
    const head = root.querySelector('head');
    if (head) {
        head.insertAdjacentHTML('afterbegin', INJECT_SCRIPT(proxyHost));
    }

    const tags = {
        'a': 'href', 'img': 'src', 'link': 'href', 'script': 'src',
        'form': 'action', 'iframe': 'src', 'source': 'src', 'video': 'src'
    };

    for (const [tag, attr] of Object.entries(tags)) {
        root.querySelectorAll(tag).forEach(el => {
            const originalVal = el.getAttribute(attr);
            if (originalVal && !originalVal.startsWith('javascript:') && !originalVal.startsWith('#')) {
                try {
                    // 相対パスを絶対パスに直してから、プロキシのURLをくっつけるんだ。
                    const absoluteUrl = new URL(originalVal, targetOrigin).href;
                    el.setAttribute(attr, proxyPrefix + absoluteUrl);
                } catch (e) {
                    // URLが変な時は無視するよ
                }
            }
        });
    }

    return root.toString();
}

// ルート設定を修正（最新のExpress/path-to-regexpに対応）
app.use('/proxy', async (req, res, next) => {
    const targetUrl = req.url.startsWith('/') ? req.url.slice(1) : req.url;
    
    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).send('URLがおかしいよ。例: /proxy/https://x.com');
    }

    const targetOrigin = new URL(targetUrl).origin;

    const proxy = createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        secure: false,
        ws: true,
        followRedirects: false,
        selfHandleResponse: true, 
        onProxyRes: async function (proxyRes, req, res) {
            const bodyChunks = [];
            proxyRes.on('data', chunk => bodyChunks.push(chunk));
            proxyRes.on('end', () => {
                const body = Buffer.concat(bodyChunks);
                const contentType = proxyRes.headers['content-type'] || '';

                // リダイレクトの処理
                if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers['location']) {
                    const originalLocation = proxyRes.headers['location'];
                    try {
                        const absoluteLocation = new URL(originalLocation, targetUrl).href;
                        res.redirect(`https://${req.get('host')}/proxy/${absoluteLocation}`);
                    } catch (e) {
                        res.set(proxyRes.headers);
                        res.send(body);
                    }
                    return;
                }

                // HTMLの場合は中身を書き換える！
                if (contentType.includes('text/html')) {
                    const html = body.toString();
                    const rewrittenHtml = rewriteUrls(html, req.get('host'), targetOrigin);
                    res.set('Content-Type', 'text/html');
                    res.send(rewrittenHtml);
                } else {
                    res.set(proxyRes.headers);
                    res.send(body);
                }
            });
        },
        onError: (err, req, res) => {
            res.status(500).send('エラーだよ: ' + err.message);
        }
    });

    proxy(req, res, next);
});

app.get('/', (req, res) => {
    res.send(`
        <body style="background:#000;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
            <h1>𝕏-Startpage Proxy</h1>
            <p>どんなサイトもプロキシの中に閉じ込めてあげるよ。</p>
            <input type="text" id="url" placeholder="https://x.com" style="width:400px;padding:10px;border-radius:20px;border:none;">
            <button onclick="location.href='/proxy/'+document.getElementById('url').value" style="margin-top:20px;padding:10px 30px;border-radius:20px;border:none;background:#1d9bf0;color:#fff;cursor:pointer;">Anonymous View</button>
        </body>
    `);
});

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));

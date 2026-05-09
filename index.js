const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORSを全部許可するよ。これがないとブラウザが怒るからね。
app.use(cors());

// 初心者へのメモ：ここでプロキシの設定をしているんだ。
// /proxy/https://example.com みたいにアクセスすると、ターゲットのサイトに化けてくれるよ。
app.use('/proxy', (req, res, next) => {
    // パスの先頭のスラッシュを削ってターゲットURLを取り出すよ
    const targetUrl = req.url.startsWith('/') ? req.url.slice(1) : req.url;
    
    if (!targetUrl || !targetUrl.startsWith('http')) {
        return res.status(400).send('URLが正しくないよ。httpから入れてね。例: /proxy/https://google.com');
    }

    console.log(`[Proxy] Target: ${targetUrl}`);

    const proxy = createProxyMiddleware({
        target: targetUrl,
        changeOrigin: true,
        secure: false,
        ws: true,
        followRedirects: false, // 勝手にリダイレクトさせない。僕がコントロールする！
        pathRewrite: (path) => '',
        onProxyRes: function (proxyRes, req, res) {
            // 1. リダイレクト(301, 302等)のLocationヘッダーを書き換える
            // 初心者へのメモ：相手が「あっちに行け」と言ってきたら、
            // 「あっち（プロキシ経由）」に行くように行き先を書き換えてあげるんだ。
            if (proxyRes.headers['location']) {
                const originalLocation = proxyRes.headers['location'];
                try {
                    const absoluteLocation = new URL(originalLocation, targetUrl).href;
                    proxyRes.headers['location'] = `${req.protocol}://${req.get('host')}/proxy/${absoluteLocation}`;
                } catch (e) {
                    // URLが変な時はそのままにしておくよ
                }
            }

            // 2. セキュリティヘッダーを徹底的に剥ぎ取る
            delete proxyRes.headers['x-frame-options'];
            delete proxyRes.headers['content-security-policy'];
            delete proxyRes.headers['content-security-policy-report-only'];
            delete proxyRes.headers['x-content-type-options'];
            proxyRes.headers['access-control-allow-origin'] = '*';
            proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        },
        onError: (err, req, res) => {
            res.status(500).send('プロキシ中にエラーが起きちゃった。: ' + err.message);
        }
    });

    proxy(req, res, next);
});

// ルートへのアクセスには簡単な案内を表示するよ。
app.get('/', (req, res) => {
    res.send(`
        <h1>本格プロキシサーバー 稼働中</h1>
        <p>使いかた: /proxy/https://google.com みたいにアクセスしてね。</p>
        <p>Renderで動いてるなんて、ちょっとプロっぽいでしょ？</p>
    `);
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Try: http://localhost:${PORT}/proxy/https://example.com`);
});

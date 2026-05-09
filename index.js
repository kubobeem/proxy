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
        // パス書き換えのルールをシンプルにするよ
        pathRewrite: (path) => {
            return ''; // ターゲットに対してはパスなしでリクエストを飛ばす（URLに全部含まれてるからね）
        },
        onProxyRes: function (proxyRes, req, res) {
            // セキュリティヘッダーを無理やり剥ぎ取るんだ。
            // これで iframe の中にも表示されるようになる（はずだよ）。
            delete proxyRes.headers['x-frame-options'];
            delete proxyRes.headers['content-security-policy'];
            proxyRes.headers['access-control-allow-origin'] = '*';
        },
        onError: (err, req, res) => {
            res.status(500).send('プロキシ中にエラーが起きちゃった。ごめんね。: ' + err.message);
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

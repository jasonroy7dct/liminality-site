// netlify/functions/medium.js
const Parser = require('rss-parser');
const parser = new Parser();

exports.handler = async function (event, context) {
  try {
    const feedUrl = 'https://jasonroy7dct.medium.com/feed';

    const feed = await parser.parseURL(feedUrl);

    const posts = (feed.items || []).map((item) => {
      const iso = item.isoDate || item.pubDate || null;

      // 顯示用日期
      let displayDate = '';
      if (iso) {
        displayDate = new Date(iso).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }

      // 內容 HTML（Medium RSS 通常放在 content:encoded）
      const contentHtml =
        item['content:encoded'] || item.content || '<p>(No content)</p>';

      return {
        id: item.guid || item.link,          // 唯一 id
        title: item.title || '(No title)',
        date: displayDate,                   // 給前端顯示
        dateISO: iso,                        // 給排序用
        summary: item.contentSnippet || '',  // 簡短摘要
        link: item.link,                     // 原始 Medium 連結
        contentHtml,                         // 完整 HTML
        source: 'medium',                    // 來源標記（之後可以用）
      };
    });

    // 依時間新→舊排序
    posts.sort((a, b) => {
      const da = new Date(a.dateISO || a.date || 0).getTime();
      const db = new Date(b.dateISO || b.date || 0).getTime();
      return db - da;
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts }),
    };
  } catch (err) {
    console.error('Medium RSS error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to load Medium RSS' }),
    };
  }
};

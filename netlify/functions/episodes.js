// netlify/functions/episodes.js

// Netlify Functions v1 (CommonJS) 寫法
exports.handler = async function (event, context) {
  try {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const showId = process.env.SPOTIFY_SHOW_ID;

    if (!clientId || !clientSecret || !showId) {
      console.error('Missing Spotify env vars');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server misconfigured: missing SPOTIFY_* env vars' }),
      };
    }

    // 1) 先用 Client Credentials Flow 拿 access token
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization':
          'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('Spotify token error:', tokenRes.status, text);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to get Spotify token' }),
      };
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // 2) 拿節目集數
    const episodesRes = await fetch(
      `https://api.spotify.com/v1/shows/${showId}/episodes?market=US&limit=20`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!episodesRes.ok) {
      const text = await episodesRes.text();
      console.error('Spotify episodes error:', episodesRes.status, text);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch episodes from Spotify' }),
      };
    }

    const episodesJson = await episodesRes.json();

    // 3) 把 Spotify 回來的資料轉成前端 main.js 要的 shape
    const episodes = (episodesJson.items || []).map((ep) => {
      // 把毫秒轉成「xx min」這種字串
      const durationMs = ep.duration_ms || 0;
      const mins = Math.round(durationMs / 60000);
      const durationText = `${mins} min`;

      const imageUrl =
        (ep.images && ep.images.length > 0 && ep.images[0].url) ||
        'https://i.scdn.co/image/ab67656300005f1fdd889d98f1e5429940d4da14';

      return {
        id: ep.id,
        number: ep.episode_number || null,
        title: ep.name,
        date: ep.release_date,
        duration: durationText,
        description: ep.description || '',
        imageUrl,
        spotifyLink: ep.external_urls?.spotify || `https://open.spotify.com/episode/${ep.id}`,
        spotifyEmbed: `https://open.spotify.com/embed/episode/${ep.id}?utm_source=generator`,
      };
    });

    console.log(`[episodes] returning ${episodes.length} episodes from Spotify`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ episodes }),
    };
  } catch (err) {
    console.error('Unexpected error in episodes function:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
